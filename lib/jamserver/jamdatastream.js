var Redis = require('redis');
var cbor = require('cbor');

class JAMDatastream {

    static jDataStreamList = {}

    /**
     * @param {String} dev_id
     * @param {String} key
     * @param {boolean} fresh - TODO: What is this
     * @param {JAMManager} jammanager
     * @param {int} refresh_rate
     * @param {int} slots - Amount of entries to store
     * @param {Redis} redis
     */

    constructor(dev_id, key, fresh, jammanager, refresh_rate, slots) {
        // Attributes
        this.dev_id = dev_id;
        this.key = key + '';
        this.transformer = (input) => input;
        this.space = slots && slots > 0 ? parseInt(slots) : -1;

        // Associated Objects
        this.jamdatastream = [];
        this.jamdatasource = null;
        this.jammanager = jammanager;
        this.jamredis = jammanager.jamredis;
        this.level = jammanager.getLevelCode();

        // States
        this.set_size = 0;
        this.fresh = fresh;
        this.isBusy = false;
        this.hasData = false;

        // Data Related
        this.index_of_last_value = 0;
        this.data_values = [];
        this.data_rcv_callback = undefined;        // Allows user specific action to occur at every event for this datastream

        this.redis = Redis.createClient({
            "host": jammanager.host,
            "port": jammanager.port,
            "return_buffers": true
        });
        // Register this JAMDatastream to the JAMManager


        // How frequent to refresh JData value
        // 0 < = No Refresh values
        // 0   = refresh as event arrives
        // > 0 = refresh every ms
        if (refresh_rate === undefined) {
            this.refresh_rate = 0;
        } else {
            this.refresh_rate = refresh_rate;
        }
        // Force data refresh the first time the datastream is created
        // this.request_value_refresh(true);

        JAMDatastream.jDataStreamList[this.key] = this;
    }

    size() {
        return this.data_values.length;
    }
    isEmpty() {
        return this.size() === 0;
    }

    setKey(key) {
        let currKey = this.key;

        // Check if the key is an object and convert it to string
        if (Boolean(key) && typeof key === 'object')
            this.key = this.jammanager.buildKey(key);
        else
            this.key = key;

        // Delete current JAMDataStream and add new JAMDataStream
        if (JAMDatastream.jDataStreamList[currKey])
            delete JAMDatastream.jDataStreamList[currKey];

        JAMDatastream.jDataStreamList[currKey] = this;
    }
    deleteKey() {
        this.redis.del(this.key);
    }
    setTransformer(func) {
        if (typeof func === 'function')
            this.transformer = func;
        return this;
    }
    setDatasource(jamdatasource) {
        this.jamdatasource = jamdatasource;
    }

    getKey() {
        return this.key;
    }
    getLevel() {
        return this.level;
    }
    getDeviceId() {
        return this.dev_id;
    }
    getDatasource() {
        return this.jamdatasource;
    }


    /**** PUBLIC API ****/

    /** @return {{value: number, timestamp: Date}} **/
    lastData() {
        if (!this.isEmpty()) {
            let data = this.data_values[this.size() - 1];
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

    // TODO: ??
    async getLastValueSync(timeout) {
        let self = this;
        let val = this.getLastValue();
        if (val !== null)
            return val;

        let promise = new Promise(resolve => {
            var f = function () {
                if (self.lastValue() === null)
                    setTimeout(f, 100);
                else
                    resolve(self.lastValue());
            };
            f();
        });
        if (timeout) {
            return await Promise.race([new Promise((resolve, reject) => {
                setTimeout(reject, timeout)
            }), promise]).catch(error => null);
        } else {
            return await promise;
        }
    }

    /** @return {{value: number, timestamp: Date}[]} **/
    data() {
        if (this.isEmpty()) {
            return null;
        }
        return this.data_values.map(
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



    request_value_refresh(force) {
        // There's no point requesting for data if there is nothing ...
        var process = this.process_zrange_response;
        var datastream = this;

        // if (force || this.index_of_last_value + 1 < this.set_size) {
        //     this.zrange(this.key, this.index_of_last_value + 1, -1,
        //         function(e, response) {
        //             process(e, response, datastream);
        //         });
        // }
        // else
        //     console.log("FAILED TO ZRANGE IN LOGGER");
        if (this.isBusy) {
            this.hasData = true;
            return;
        }

        this.isBusy = true;
        this.hasData = false;

        this.zrange(this.key, this.index_of_last_value, -1,
            function (e, response) {
                process(e, response, datastream);
            });
        if (this.refresh_rate > 0) {
            setTimeout(this.request_value_refresh.bind(this), this.refresh_rate);
        }
    }

    process_zrange_response(error, response, datastream) {
        var entry;
        var dest = datastream.jamdatasource.getDestination();

        if (error) {
            datastream.isBusy = false;
            throw error;
        } else {
            if (response === undefined) {
                datastream.isBusy = false;
                if (datastream.hasData)
                    datastream.request_value_refresh();
                return;
            }

            for (var i = 0; i < response.length; i++) {
                var dval = cbor.decodeFirstSync(response[i]);
                var log = dval.value;
                var timestamp = dval.timestamp;

                // try {
                //     log = cbor.decodeFirstSync(log);
                //     // if (debug) console.log(log);
                // } catch(e) {
                //     console.log("WARN! Error decoding data.. ", log)
                // }
                // }

                //console.log("Before log transform:", log);

                entry = {
                    log: datastream.transformer(log, datastream),
                    time_stamp: timestamp
                };

                datastream.data_values.push(entry);
                datastream.index_of_last_value++;
                datastream.set_size++;

                //console.log("After log transform:", entry.log);

                /*
                 if(refresh_size && i == response.length -1){
                 //Attempt to update the size ... in case it did not update or misssed it
                 var size = parseInt(response[i].slice(response[i].lastIndexOf(this.delimiter, time_stamp_index - 1) + 3, time_stamp_index));
                 if(size > this.set_size)
                 this.set_size = size;
                 }*/

                if (datastream.data_rcv_callback) {
                    datastream.data_rcv_callback(response[i]);
                }


                //Check if this stream is to be sent to the parent
                let forward = false;
                if (datastream.jammanager.jamredis.getParentCon() != null) {//if the redis connection to parent is not null
                    switch (datastream.level) {
                        case "dev":
                        case "device":
                            if (dest === "fog" || dest === "cloud")
                                forward = true;
                            break;
                        case "fog":
                            if (dest === "cloud")
                                forward = true;
                    }
                } else {
                    //console.error("Parent Redis is null");
                }

                if (forward) {
                    //make copy and adapt the log to the transformed copy
                    datastream.logParent(datastream.key, response[i], null, timestamp);
                }
            }

            // if (datastream.index_of_last_value + 1 > datastream.set_size) {
            //     datastream.set_size = datastream.index_of_last_value;
            // }

            let hasData = datastream.hasData;
            datastream.isBusy = false;
            if (hasData)
                setTimeout(datastream.request_value_refresh.bind(datastream), 0);
        }
    }

    zrange(key, start, range, callback) {
        this.redis.zrange([key, start, range], callback);
    }

    log(entry, callback, redis) {
        let entryType = typeof entry;
        let datatype = this.jamdatasource.getDataType();

        redis = redis ? redis : this.redis;
        callback = callback ? callback : () => false;

        // Check for existing data type setting
        if (datatype) {
            // Check if this JAMDataStream accept this type of data
            if (entryType != datatype) {
                callback({
                    status: false,
                    error: "Only data of type " + datatype + " is allowed"
                });
                return;
            }
        } else {
            this.jamdatasource.setDataType(entryType);
        }

        // Parse entry
        if (entryType === "object") {
            entry = JSON.stringify(entry);
        } else if (entryType !== 'number' && entryType !== 'string') {
            callback({
                status: false,
                error: "Only data of type " + datatype + " is allowed"
            });
            return;
        }

        let curTime = Date.now();
        let entryObject = {
            value: entry,
            timestamp: curTime
        }

        let cb = function (error, response) {
            if (error) {
                if (callback) {
                    callback({
                        status: false,
                        error: error
                    });
                }
            } else {
                if (callback) {
                    (function (time) {
                        setTimeout(function () {
                            callback({
                                status: true,
                                message: 'Data added!',
                                timestamp: time
                            });
                        }, 0);
                    })(curTime);
                }
            }
        };

        this.jamredis.logData(this.key, curTime, cbor.encode(entryObject), cb, true);
    }

    logParent(key, value, callback, timestamp) {
        let cb = function (error) {
            if (error) {
                if (callback) {
                    callback({
                        status: false,
                        error: error
                    });
                }
            } else if (callback) {
                setTimeout(function () {
                    callback({
                        status: true,
                        message: 'Process Completed Successfully!',
                        timestamp: timestamp
                    });
                }, 0);
            }
        };

        this.jamredis.logData(key, timestamp, value, cb, false)
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


module.exports = JAMDatastream;


