// TODO: Having a buffer to not "miss" or "lose" data
const cbor = require("cbor")

class JAMDatastream {

    static jDataStreamList = {}         // List of all JAMDataStreams hashed by its key

    /**
     * @param {String} deviceID
     * @param {String} key
     * @param {JAMManager} jammanager
     * @param {JAMDatasource} jamdatasource
     */
    constructor(deviceID, key, jammanager, jamdatasource) {
        // Attributes
        this.key = key + '';
        this.dev_id = deviceID;

        // Associated Objects
        this.jammanager = jammanager;
        this.jamredis = jammanager.jamredis;
        this.jamdatasource = jamdatasource;

        // States
        this.isBusy = false;            // Indicates a data query in progress
        this.hasNewData = false;        // Indicates existence of new data to be queried
        this.listeners = [];            // JAMProgram client listeners on the JAMDatastream

        // Data Related
        this.dataValues = [];
        this.lastTimestamp = "0";
        this.transformer = (input) => input;

        JAMDatastream.jDataStreamList[this.key] = this;     // Add 'this' to the list
    }


    /*******************************
     ********** PUBLIC API **********
     *******************************/

    size() {
        return this.dataValues.length;
    }

    isEmpty() {
        return this.size() === 0;
    }

    setKey(key) {
        let currKey = this.key;

        // Check if the key is an object and convert it to string
        if (Boolean(key) && typeof key === 'object')
            this.key = _buildKey(key);
        else
            this.key = key;

        // Delete current JAMDataStream and add new JAMDataStream
        if (JAMDatastream.jDataStreamList[currKey])
            delete JAMDatastream.jDataStreamList[currKey];

        JAMDatastream.jDataStreamList[currKey] = this;
    }

    setTransformer(func) {
        if (typeof func === 'function')
            this.transformer = func;
        return this;
    }

    getDeviceId() {
        return this.dev_id;
    }

    /**
     * "Subscribes" the listener by adding to the list
     * @param {Object} listener
     * @param {function(key, entry)} listener.notify - Callback upon each new data
     */
    subscribe(listener) {
        this.listeners.push(listener);
    }

    /**
     * "Unsubscribes" the listener by removing from the list
     * @param {Object} listener
     * @param {function(key, entry)} listener.notify - Callback upon each new data
     */
    unsubscribe(listener) {
        for (let i = 0; i < this.listeners.length; i++) {
            if (this.listeners[i] == listener) {
                this.listeners.splice(i, 1);
                break;
            }
        }
    }


    /***** DATA QUERIES *****/

    lastData() {
        if (!this.isEmpty()) {
            let data = this.dataValues[this.size() - 1];
            let value = _parseData(data);
            return {
                value: value,
                timestamp: new Date(data.time_stamp * 1000)
            };
        }
        return null;
    }

    lastValue() {
        if (!this.isEmpty()) {
            return this.lastData().value
        }
        return null;
    }

    data() {
        if (this.isEmpty()) {
            return null;
        }
        return this.dataValues.map(
            /** @param {{value: number, time_stamp: Date}} data **/
            function (data) {
                let value = _parseData(data);
                return {
                    value: value,
                    timestamp: new Date(data.time_stamp * 1000)
                };
            });
    }

    values() {
        if (this.isEmpty()) return null;
        return this.data().map(
            function (data) {
                return data.value;
            })
    }

    n_data(N) {
        if (!Number.isInteger(N) || N <= 0) {
            throw new TypeError('N must be a positive integer');
        }

        if (this.isEmpty()) {
            return [];
        }

        if (N > this.size()) {
            N = this.size();
        }

        return this.data().slice(this.size() - N);
    }

    n_values(N) {
        return this.n_data(N).map(
            function (data) {
                return data.value;
            });
    }

    dataAfter(timestamp) {
        return this.data().filter(
            function (data) {
                return Math.floor(timestamp.getTime() / 1000) < data.timestamp;
            });
    }

    valuesAfter(timestamp) {
        return this.dataAfter(timestamp).map(function (data) {
            return data.value;
        });
    }

    dataBetween(fromTimestamp, toTimestamp) {
        return this.data().filter(function (data) {
            return Math.floor(fromTimestamp.getTime() / 1000) < data.timestamp &&
                data.timestamp < Math.floor(toTimestamp.getTime() / 1000);
        });
    }

    valuesBetween(fromTimestamp, toTimestamp) {
        return this.dataBetween(fromTimestamp, toTimestamp).map(function (data) {
            return data.value;
        });
    }


    /*******************************
     *********** LOGGING ***********
     *******************************/

    /**
     * TODO: Remove manual timestamping, modify callback to push dataValues
     * Logs to local Redis
     * @param entry
     * @param {function(Object):void} callback
     */
    log(entry, callback) {
        let entryType = typeof entry;
        let dataType = this.jamdatasource.getDataType();

        callback = callback ? callback : () => false;

        // TODO: Consider enforcing the data type on creation
        // Check for existing data type setting and whether it is accepted by this JAMDatastream
        if (dataType) {
            if (entryType != dataType || (entryType !== 'number' && entryType !== 'string')) {
                callback({
                    status: false,
                    error: "Only data of type " + dataType + " is allowed"
                });
                return;
            }
        } else {
            this.jamdatasource.setDataType(entryType);
        }

        let time = Date.now()

        this.dataValues.push({
            log: entry,
            time_stamp: time
        });
        entry = cbor.encode(entry);

        // Log entry with current timestamp to the local and parent Redis
        this.jamredis.logData(this.key, time, entry, callback, true);
        this.jamredis.logData(this.key, time, entry, null, false);
    }

    /* Query new data in the local Redis, and then log it in the parent Redis */
    queryNewData() {
        // Don't query again if the previous query is not served, instead indicate there are new data
        if (this.isBusy) {
            this.hasNewData = true;
            return;
        }
        // Toggle busy and new data flag before starting to query
        this.isBusy = true;
        this.hasNewData = false;

        if (this.jamredis) {
            this.jamredis.queryDataAfter(this.key, this.lastTimestamp, this.dataCB.bind(this), this.queryCB.bind(this));
        }
    }

    /**
     * TODO: Handle new parsing method
     * Callback for saving data into local cache and log to parent Redis
     * @param log : Object
     * @param timestamp : int
     */
    dataCB(log, timestamp) {
        for (let i = 0; i < log.length; i++) {
            let entry = {
                log: this.transformer(cbor.decodeFirstSync(log[i]).value),         // Transform data before savings
                time_stamp: timestamp[i]
            }
            this.dataValues.push(entry)             // Save data in local cache
            this.lastTimestamp = timestamp[i];      // Update last entry timestamp

            // Notify all listeners
            for (let listener of this.listeners) {
                listener.notify(this.key, entry);
            }

            // Log to parent if possible/necessary
            this.jamredis.logData(this.key, timestamp[i], log[i], null, false)
        }
    }

    /**
     * Callback for handling data query processing completion
     * @param isError : boolean
     */
    queryCB(isError) {
        this.isBusy = false;
        if (!isError && this.hasNewData) {
            setTimeout(this.queryNewData.bind(this), 0);
        }
    }


    /*********************************************
     ********** SENTINEL (EXPERIMENTAL) **********
     *********************************************/

    static async failoverEvent() {
        let jDSList = JAMDatastream.jDataStreamList;

        // Synchronously get the last element timestamp for each JAMDatastream
        for (let key in jDSList) {
            let jDatastream = jDSList[key];
            await jDatastream.jamredis.xinfoSync(jDatastream.key)
                .then(function (lastElementTime) {
                    // Query and log the data since the last element ID
                    if (lastElementTime < jDatastream.lastData().timestamp) {
                        jDatastream.jamredis.queryDataAfter(jDatastream.key, lastElementTime,
                            jDatastream.dataCB.bind(jDatastream), jDatastream.queryCB.bind(jDatastream))
                    }
                })
        }
    }
}


/************************************
 ********** HELPER METHODS **********
 ************************************/

function _parseData(data) {
    let value;
    // Convert content of String data to a number if it is
    if (Number(data.log) === data.log) {
        value = Number(data.log);
    }
    // Parse the JSON object if the string starts with '{'
    else if (String(data.log).indexOf('{') === 0) {
        try {
            value = JSON.parse(data.log);
        } catch (e) {
            value = data.log;
        }
    } else {
        value = data.log;
    }
    return value;
}

function _buildKey(obj) {
    let key = 'aps[' + obj.app + ']';
    if (obj.namespace)
        key = key + '.ns[' + obj.namespace + ']';
    if (obj.flow)
        key = key + '.flow[' + obj.flow + ']';
    if (obj.datasource)
        key = key + '.ds[' + obj.datasource + ']';
    if (obj.datastream)
        key = key + '.dts[' + obj.datastream + ']';

    return key;
}


module.exports = JAMDatastream;


