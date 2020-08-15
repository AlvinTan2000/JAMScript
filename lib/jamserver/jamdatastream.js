// TODO: Having a buffer to not "miss" or "lose" data

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

        // Data Related
        this.dataValues = [];
        this.lastTimestamp = 0;
        this.transformer = (input) => input;

        JAMDatastream.jDataStreamList[this.key] = this;     // Add 'this' to the list
    }

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


    /**** PUBLIC API ****/

    /**
     * @returns {null | {value: *, timestamp: Date}}
     */
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

    /** @return {{value: number, timestamp: Date}[]} **/
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

    /** @return {number[]} **/
    values() {
        if (this.isEmpty()) return null;
        return this.data().map(
            function (data) {
                return data.value;
            })
    }

    /** Note: Length of the returned array can be smaller than N
     * @pre Number.isInteger(N)
     * @pre N >= 0
     * @return {{value: number, timestamp: Date}[]}
     */
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

    /** Note: Length of the returned array can be smaller than N
     * @pre Number.isInteger(N)
     * @pre N >= 0
     * @return {number[]}
     */
    n_values(N) {
        return this.n_data(N).map(
            function (data) {
                return data.value;
            });
    }

    /**
     * @param {Date} timestamp
     * @return {{value: number, timestamp: Date}[]}
     */
    dataAfter(timestamp) {
        return this.data().filter(
            function (data) {
                return Math.floor(timestamp.getTime() / 1000) < data.timestamp;
            });
    }

    /**
     * @param {Date} timestamp
     * @return {number[]}
     */
    valuesAfter(timestamp) {
        return this.dataAfter(timestamp).map(function (data) {
            return data.value;
        });
    }

    /**
     * @param {Date} fromTimestamp
     * @param {Date} toTimestamp
     * @return {{value: number, timestamp: Date}[]}
     */
    dataBetween(fromTimestamp, toTimestamp) {
        return this.data().filter(function (data) {
            return Math.floor(fromTimestamp.getTime() / 1000) < data.timestamp &&
                data.timestamp < Math.floor(toTimestamp.getTime() / 1000);
        });
    }

    /**
     * @param {Date} fromTimestamp
     * @param {Date} toTimestamp
     * @return {number[]}
     */
    valuesBetween(fromTimestamp, toTimestamp) {
        return this.dataBetween(fromTimestamp, toTimestamp).map(function (data) {
            return data.value;
        });
    }


    /***** LOGGING IMPLEMENTATION *****/

    /**
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

        // Log entry with current timestamp to the local and parent Redis
        this.jamredis.logData(this.key, time, entry, callback, true);
        this.jamredis.logData(this.key, time, entry, console.log, false);
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

    // TODO: Transform the data before sending upwards?
    /**
     * Callback for saving data into local cache and log to parent Redis
     * @param log : Object
     * @param timestamp : int
     */
    dataCB(log, timestamp) {
        console.log("start of dataCB")

        let entry = {
            log: this.transformer(log),         // Transform data before savings
            time_stamp: timestamp
        }
        this.dataValues.push(entry)             // Save data in local cache
        this.lastTimestamp = timestamp;         // Update last entry timestamp

        // Log to parent if possible/necessary
        this.jamredis.logData(this.key, timestamp, log, console.log, false)

        console.log("end of dataCB")
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


    // TODO: Implement seperate garbage collection for streams


    static async failoverEvent() {
        let jdataList = JAMDatastream.jDataStreamList
        for (let key in jdataList) {
            let jdatastream = jdataList[key];
            jdatastream.jamredis.getXinfo(jdatastream.key)
                .then(async function (time) {
                    console.log("XINFO callback", jdatastream.lastData())
                    if (time < jdatastream.lastData().timestamp) {
                        jdatastream.jamredis.queryDataAfter(jdatastream.key, time, jdatastream.dataCB.bind(jdatastream), jdatastream.queryCB.bind(jdatastream))
                        console.log("done query data after sync")
                    }
                })
            console.log("done")
        }
    }
}

/** Helper Methods Outside of Class: **/
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


