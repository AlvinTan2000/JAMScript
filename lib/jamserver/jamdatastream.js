let Redis = require('redis');
let cbor = require('cbor');
let debug = false;

module.exports = JAMDatastream;

// TODO: Do we need setters and getter if everything is public? Are we going to enforce encapsulation?
// TODO: Catch exceptions are weird

class JAMDatastream {

    // TODO: Any need for passing redis? Any need for data_prototype?
    /**
     * @param {String} dev_id
     * @param {String} key
     * @param {boolean} fresh - TODO: What is this
     * @param {JAMManager} jammanager
     * @param {} data_prototype
     * @param {int} refresh_rate
     * @param {int} slots - Amount of entries to store
     * @param {Redis} redis
     */
    constructor(dev_id, key, fresh, jammanager, data_prototype, refresh_rate, slots, redis) {
        if (debug) {
            console.log("Creating datastream ... " + key);
        }

        // Attributes
        this.dev_id = dev_id;
        this.key = key + '';
        this.transformer = (input) => input;
        this.space = slots && slots > 0 ? parseInt(slots) : -1;

        // Associated Objects
        this.listeners = [];                       // TODO: What does this store
        this.jamdatastream = [];                   // TODO: What does this store
        this.jamdatasource = null;
        this.jammanager = jammanager;
        this.level = jammanager.getLevelCode();

        // States
        this.set_size = 0;
        this.fresh = fresh;
        this.isBusy = false;    // TODO: Purpose?
        this.hasData = false;   // TODO: Purpose?

        // Data Related
        this.lastValueIndex = 0;
        this.data_values = [];                     // TODO: Whata data type is this
        this.data_rcv_callback = undefined;        // Allows user specific action to occur at every event for this datastream

        // TODO: What are refreshing?
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
        this.request_value_refresh(true);

        // TODO: It is going to be assigned by jammanager anyways...
        this.redis = redis ? redis : Redis.createClient({
            "host": jammanager.host,
            "port": jammanager.port,
            "return_buffers": true
        });

        // Register this JAMDatastream to the JAMManager 
        if (jammanager) {
            jammanager.add_jamdatastream(this);
        }
    }

    size() {
        return this.data_values.length;
    }

    isEmpty() {
        return this.size() === 0;
    }


    // TODO: Why need a separate function?
    setDatasource(jamdatasource) {
        this.jamdatasource = jamdatasource;
    }

    getDatasource() {
        return this.jamdatasource;
    }

    getDeviceId() {
        return this.dev_id;
    }

    getLevel() {
        return this.level;
    }

    // TODO: Why return this?
    setTransformer(func) {
        if (typeof func === 'function')
            this.transformer = func;
        return this;
    }


    /** @return {Number, Date} **/
    getLastData() {
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

    // TODO: What is this for?
    async getLastValueSync(timeout) {
        let self = this;
        let val = this.getLastData().value;
        if (val !== null)
            return val;

        let promise = new Promise(resolve => {
            let f = function () {
                if (self.getLastData().value === null)
                    setTimeout(f, 100);
                else
                    resolve(self.getLastData().value);
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

    /** @return [{Number, Date}] **/
    getAllData() {
        if (this.isEmpty()) {
            return null;
        }

        return this.data_values.map(function (data) {
            let value = _parseData(data);
            return {
                value: value,
                timestamp: new Date(data.time_stamp * 1000)
            };
        });
    }

    /* Returns an array containing all values (of type Number) in the data stream */
    values(){
        return this.getAllData().map(function (data){
            return data.value;
        })
    }

    /** Returns an array containing the last N data pairs (value, timestamp) in the data stream
     Length of the returned array can be smaller than N

     @pre Number.isInteger(N)
     @pre N >= 0

     @return {Number, Date}
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

        return this.data_values.slice(this.size() - N).map(function (d) {
            let value;
            // if the content of the string is a number
            if (Number(d.log) == d.log) value = Number(d.log);
            // if the string starts with '{' then it could have been a JSON object
            else if (String(d.log).indexOf('{') === 0) {
                try {
                    value = JSON.parse(d.log);
                } catch (e) {
                    value = d.log;
                }
            } else value = d.log;
            return {
                value: value,
                timestamp: new Date(d.time_stamp * 1000)
            };
        });
    }

    /** Returns an array containing the last N values (of type Number) in the data stream.
     Length of the returned array can be smaller than N.

     @pre Number.isInteger(N)
     @pre N >= 0

     @return Number
     */
    n_values(N) {
        if (!Number.isInteger(N)) {
            throw new TypeError('N must be a positive integer');
        }

        if (N <= 0) {
            throw new RangeError('N must be a positive integer');
        }

        if (this.isEmpty()) {
            return [];
        }

        if (N > this.size()) {
            N = this.size();
        }

        return this.data_values.slice(this.size() - N).map(function (d) {
            let value;
            // if the content of the string is a number
            if (Number(d.log) == d.log) value = Number(d.log);
            // if the string starts with '{' then it could have been a JSON object
            else if (String(d.log).indexOf('{') === 0) {
                try {
                    value = JSON.parse(d.log);
                } catch (e) {
                    value = d.log;
                }
            } else value = d.log;
            return value;
        });
    }

    /**  Returns an array containing all data pairs (value, timestamp) in the data
     stream with a timestamp after timestamp (exclusive).

     @param {Date} timestamp

     @return {Number, Date}
     */
    dataAfter(timestamp) {
        return this.data_values.filter(function (d) {
            return Math.floor(timestamp.getTime() / 1000) < d.time_stamp;
        }).map(function (d) {
            let value;
            // if the content of the string is a number
            if (Number(d.log) == d.log) value = Number(d.log);
            // if the string starts with '{' then it could have been a JSON object
            else if (String(d.log).indexOf('{') === 0) {
                try {
                    value = JSON.parse(d.log);
                } catch (e) {
                    value = d.log;
                }
            } else value = d.log;
            return {
                value: value,
                timestamp: new Date(d.time_stamp * 1000)
            };
        });
    }

    /** Returns an array containing all values (of type Number) the data stream with
     a timestamp after timestamp (exclusive).

     @param {Date} timestamp

     @return {Number, Date}
     */

    valuesAfter(timestamp) {
        return this.data_values.filter(function (d) {
            return Math.floor(timestamp.getTime() / 1000) < d.time_stamp;
        }).map(function (d) {
            let value;
            // if the content of the string is a number
            if (Number(d.log) == d.log) value = Number(d.log);
            // if the string starts with '{' then it could have been a JSON object
            else if (String(d.log).indexOf('{') === 0) {
                try {
                    value = JSON.parse(d.log);
                } catch (e) {
                    value = d.log;
                }
            } else value = d.log;
            return value;
        });
    }

    /**  Returns an array containing all data pairs (value, timestamp) in the data
     stream with a timestamp between fromTimestamp and toTimestamp (both exclusive).

     @param {Date} fromTimestamp
     @param {Date} toTimestamp
     */
    dataBetween(fromTimestamp, toTimestamp) {
        return this.data_values.filter(function (d) {
            return Math.floor(fromTimestamp.getTime() / 1000) < d.time_stamp &&
                d.time_stamp < Math.floor(toTimestamp.getTime() / 1000);
        }).map(function (d) {
            let value;
            // if the content of the string is a number
            if (Number(d.log) == d.log) value = Number(d.log);
            // if the string starts with '{' then it could have been a JSON object
            else if (String(d.log).indexOf('{') === 0) {
                try {
                    value = JSON.parse(d.log);
                } catch (e) {
                    value = d.log;
                }
            } else value = d.log;
            return {
                value: value,
                timestamp: new Date(d.time_stamp * 1000)
            };
        });
    }

    /*
     valuesBetween(fromTimestamp, toTimestamp)

     Returns an array containing all values (of type Number) in the data stream
     with a timestamp between fromTimestamp and toTimestamp (both exclusive).
     Parameters fromTimestamp and toTimestamp are of type Date.

     Example:
     let fromTimestamp = new Date(2017, 1, 22, 7, 55, 16);
     let toTimestamp = new Date(2017, 1, 23, 7, 55, 16);
     let v = x[0].valuesBetween(fromTimestamp, toTimestamp);
     console.log(v.length);
     64
     console.log(v[0]); // Number
     32.5
     */
    valuesBetween(fromTimestamp, toTimestamp) {
        return this.data_values.filter(function (d) {
            return Math.floor(fromTimestamp.getTime() / 1000) < d.time_stamp &&
                d.time_stamp < Math.floor(toTimestamp.getTime() / 1000);
        }).map(function (d) {
            let value;
            // if the content of the string is a number
            if (Number(d.log) == d.log) value = Number(d.log);
            // if the string starts with '{' then it could have been a JSON object
            else if (String(d.log).indexOf('{') === 0) {
                try {
                    value = JSON.parse(d.log);
                } catch (e) {
                    value = d.log;
                }
            } else value = d.log;
            return value;
        });
    }

    // internal implementation

    set_refresh_rate(refresh_rate) {
        if (this.refresh_rate === 0) {
            setTimeout(this.request_value_refresh.bind(this), refresh_rate);
        }
        this.refresh_rate = refresh_rate;
    }

    get_series_true_size() {
        return this.set_size;
    }

    get_series_avail_size() {
        return this.data_values.length;
    }

    get_all_values() {
        return this.data_values;
    }

    request_set_size() {
        let datastream = this;
        this.redis.zcard(this.key,
            function (error, response) {
                datastream.request_set_size_callback(error, response, datastream);
            }
        );
    }

    request_set_size_callback(error, response, datastream) {
        if (error) {
            throw error;
        }
        datastream.set_size = response;
        if (datastream.fresh) {
            datastream.index_of_last_value = response - 1; //So we don't get old messages in storage previously
        }
    }

    get_newest_value() {
        if (this.set_size === 0) {
            throw "Empty Set";
        }
        return this.data_values[this.data_values.length - 1];
    }

    get_value_at(index) {
        if (this.set_size === 0) {
            throw "Empty Set";
        }
        if (index < 0 || index > this.data_values.length - 1) {
            throw "Invalid Index";
        }
        return this.data_values[index];
    }

    get_range_values(start, range) {
        if (start < 0 || start + range >= this.data_values.length) {
            throw "Invalid Range ...";
        }
        return this.data_values.slice(start, start + range);
    }

    set_new_log_callback(callback) {
        //Note the callback will be sent a single string denoting the keyword for the log
        this.data_rcv_callback = callback;
    }

    request_value_refresh(force) {
        // There's no point requesting for data if there is nothing ...
        let process = this.process_zrange_response;
        let datastream = this;

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

        this.zrange(this.key, this.lastValueIndex, -1,
            function (e, response) {
                process(e, response, datastream);
            });
        if (this.refresh_rate > 0) {
            setTimeout(this.request_value_refresh.bind(this), this.refresh_rate);
        }
    }

    process_zrange_response(e, response, datastream) {
        let entry;
        let dest = datastream.jamdatasource.getDestination();

        if (e) {
            datastream.isBusy = false;
            throw e;
        } else {
            if (response === undefined) {
                let hasData = datastream.hasData;
                datastream.isBusy = false;
                if (hasData)
                    datastream.request_value_refresh();
                return;
            }

            for (let i = 0; i < response.length; i++) {
                let dval = cbor.decodeFirstSync(response[i]);
                let log = dval.value;
                let timestamp = dval.timestamp;

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
                datastream.lastValueIndex++;
                datastream.set_size++;

                if (debug) {
                    console.log("Received data: ", entry);
                    console.log(datastream.lastValueIndex);
                }

                //console.log("After log transform:", entry.log);

                /*
                 if(refresh_size && i == response.length -1){
                 //Attempt to update the size ... in case it did not update or misssed it
                 let size = parseInt(response[i].slice(response[i].lastIndexOf(this.delimiter, time_stamp_index - 1) + 3, time_stamp_index));
                 if(size > this.set_size)
                 this.set_size = size;
                 }*/

                if (datastream.data_rcv_callback) {
                    datastream.data_rcv_callback(response[i]);
                }

                //Added by Richboy on Sat 3 June 2017
                //inform listeners about new data
                for (let listener of datastream.listeners) {

                    if (listener.notify && typeof listener.notify === 'function')
                        listener.notify.call(listener, datastream.key, entry, datastream);
                    else if (typeof listener === 'function')
                        listener.call({}, datastream.key, entry, datastream);
                }


                //Check if this stream is to be sent to the parent
                let forward = false;
                if (datastream.jammanager.getParentRedisLogger() != null) {//if the redis connection to parent is not null
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
                    datastream.jammanager.simpleLog(datastream.key, response[i], null, datastream.jammanager.getParentRedisLogger(), timestamp);
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

    // TODO: What's the point of passing a redis
    log(entry, callback, redis) {
        let self = this;

        redis = redis ? redis : this.redis;
        callback = callback ? callback : () => false;

        let entryType = typeof entry;
        let datatype = this.jamdatasource.getDataType();

        // Check if the this JAMDataStream accept this type of data
        if (datatype) {
            if (entryType !== datatype) {
                callback({
                    status: false,
                    error: "Only data of type " + datatype + " is allowed"
                });
                return;
            }
        } else {
            this.jamdatasource.setDataType(entryType);
        }

        if (entryType === "object") entry = JSON.stringify(entry);
        else if (entryType !== 'number' && entryType !== 'string') {
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
        redis.zadd([this.key, curTime, cbor.encode(entryObject)], function (e, d) {
            if (e) {
                if (callback) {
                    callback({
                        status: false,
                        error: e
                    });
                }
            } else {
                // self.datastream.push({
                //     entry: entry,
                //     timestamp: d[0] - 0
                // }); //convert the returned timestamp to a number
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

                // if addition was successful, we need to run a command to remove all previous data if
                // the amount of entries to store was set and we have exceeded the maximum set number of entries allowed
                self.performDataRegularization();
            }
        });
    }


    // TODO needs to be revised cause of the data caching
    getSeries(callback, fromMillis, toMillis) {
        let fr, to, command, i, data = [],
            self = this,
            slice;

        if (fromMillis && toMillis) {
            slice = this.jamdatastream.filter(function (object) {
                return object.timestamp >= fromMillis && object.timestamp <= toMillis;
            });

            // ensure that the data is arrange in order of timestamp increasing order
            slice.sort(function (a, b) {
                return a.timestamp - b.timestamp;
            });

            callback({
                status: true,
                data: slice
            });
        } else {
            callback({
                status: true,
                data: this.jamdatastream.slice(0, this.jamdatastream.length)
            });
        }
    }

    processEvent(event) {
        switch (event.toLowerCase()) {
            case "zadd":
                this.loadServerData();
                break;
        }
    }

    /* Gets all new data from the redis server for caching on the javascript end */
    loadServerData() {
        let fromStamp = 0,
            self = this;

        if (self.jamdatastream.length > 0) {
            fromStamp = this.jamdatastream[self.jamdatastream.length - 1].timestamp + 1;
            // Get the last set of entries from the data store and cache them
            // Add 1 to offset the millisecond so that the last one we already have would not be retrieved
        }

        self.getSeries(function (resp) {
            if (resp.status) {
                resp.data.forEach(function (obj) {
                    self.jamdatastream.push(obj);
                });
            } else {
                console.log("ERROR", resp.error);
            }
        }, fromStamp + '', 'inf');
    }

    setMaxSlots(slots) {
        this.space = slots && slots > 0 ? parseInt(slots) : -1;
        this.performDataRegularization();
    }


    // TODO: Is this suppose to be a garbage collection
    performDataRegularization() {
        let amount, from, to, self = this;

        // Check if exceeded the maximum set number of entries allowed
        if (this.space > 0 && this.jamdatastream.length > this.space) {
            amount = this.jamdatastream.length - this.space;
            from = this.jamdatastream[0].timestamp;
            to = this.jamdatastream[amount - 1].timestamp;

            this.redis.zremrangebyscore([this.key, from, to], function (e) {
                if (e) {
                    if (debug) {
                        console.log("ERROR", resp.error);
                    }
                } else {
                    self.jamdatastream.splice(0, amount);
                }
            });
        }
    }


    subscribe(listener) {
        this.listeners.push(listener);
    }

    unsubscribe(listener) {
        for (let i = 0; i < this.listeners.length; i++) {
            if (this.listeners[i] === listener) {
                this.listeners.splice(i, 1);
                break;
            }
        }
    }

    deleteKey() {
        this.redis.del(this.key);
    }

    setKey(key) {
        let currKey = this.key;

        // Check if the key is an object and convert it to string
        if (Boolean(key) && typeof key === 'object')
            this.key = this.jammanager.buildKey(key);
        else
            this.key = key;

        // Delete current JAMDataStream and add new JAMDataStream
        this.jammanager.delete_jamdatastream(currKey);
        this.jammanager.add_jamdatastream(this);
    }

    getKey() {
        return this.key;
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


