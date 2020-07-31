var cbor = require('cbor');

class JAMDatastream {

    static jDataStreamList = {}

    /**
     * @param {String} dev_id
     * @param {String} key
     * @param {JAMManager} jammanager
     * @param {JAMDatasource} jamdatasource
     * @param {int} slots - Amount of entries to store
     */
    constructor(dev_id, key, jammanager, jamdatasource, slots) {
        // Attributes
        this.dev_id = dev_id;
        this.key = key + '';
        this.space = slots && slots > 0 ? parseInt(slots) : -1;

        // Associated Objects
        this.jammanager = jammanager;
        this.jamredis = jammanager.jamredis;
        this.isNotCloud = jammanager.getLevelCode() !== "cloud";
        this.jamdatasource = jamdatasource;

        // States
        this.isBusy = false;
        this.hasNewData = false;

        // Data Related
        this.dataValues = [];
        this.lastValueIndex = 0;
        this.transformer = (input) => input;

        JAMDatastream.jDataStreamList[this.key] = this;
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

    // TODO: Having a buffer to not "miss" or "lose" data

    /** @return {{value: number, timestamp: Date}} **/
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


    // TODO: Change to Redis Streams

    /**
     * Logs to local Redis
     * @param callback : callback
     */
    log(entry, callback) {
        let entryType = typeof entry;
        let dataType = this.jamdatasource.getDataType();

        callback = callback ? callback : () => false;

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

        // Create CBOR encoded entry
        let curTime = Date.now();
        let entryObject = cbor.encode({
            value: entry,
            timestamp: curTime
        })

        this.jamredis.logData(this.key, curTime, entryObject, callback, true);
    }

    /** Query new data in the local Redis, and then log it in the parent Redis **/
    queryNewData() {
        let self = this;
        let process = this._queryDataCB;

        // Don't query again if the previous query is not served, instead indicate there are new data
        if (this.isBusy) {
            this.hasNewData = true;
            return;
        }
        // Toggle busy and new data flag before starting to query
        this.isBusy = true;
        this.hasNewData = false;

        this.jamredis.queryLocalData(this.key, this.lastValueIndex, -1,
            function (e, response) {
                process(e, response, self);
            });
    }

    _queryDataCB(error, result, datastream) {
        let entry;

        if (error) {
            datastream.isBusy = false;
            throw error;
        } else {
            // If nothing new was queried
            if (result === undefined) {
                datastream.isBusy = false;
                // Query for new data if needed
                if (datastream.hasData) {
                    datastream.queryNewData();
                }
                return;
            }

            // Iterate through each queried response
            for (let i = 0; i < result.length; i++) {
                let data = cbor.decodeFirstSync(result[i]);
                let log = data.value;
                let timestamp = data.timestamp;

                // Create transformed entry and push it into local cache
                entry = {
                    log: datastream.transformer(log, datastream),
                    time_stamp: timestamp
                };
                datastream.dataValues.push(entry);
                datastream.index_of_last_value++;

                // Log to parent if possible/necessary
                if (datastream.jamredis.getParentCon() != null && datastream.isNotCloud) {
                    datastream.jamredis.logData(datastream.key, timestamp, result[i], null, false)
                }
            }
        }

        datastream.isBusy = false;
        // Query for new data if needed
        if (datastream.hasData) {
            setTimeout(datastream.queryNewData.bind(datastream), 0);
        }
    }

    // TODO: Implement seperate garbage collection for streams
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


