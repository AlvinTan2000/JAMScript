const ebus = require('./ebus')
const Redis = require('redis');
const JAMBroadcaster = require('./jambroadcaster');
const JAMDatasource = require('./jamdatasource')
const JAMDatastream = require('./jamdatastream')

// TODO: Implement garbage collection for streams

class JAMRedis {
    /**
     * @param localHost : String
     * @param localPort : int
     */
    constructor(localHost, localPort) {
        this.parentCon = null;          // Connection host and port object of parent Redis

        // Broadcaster Related
        this.rBcastListener = null;
        this.rBcaster = this.connectRedis(localHost, localPort);        // TODO: Include PUBLISHER into pipeline?

        // Logger Related
        this.rParentLogger = null;
        this.rLocalLogger = this.connectRedis(localHost, localPort);
        this.rLogListener = this.connectRedis(localHost, localPort);

        // Pipeline Related
        this.execTime = 3000;
        this.rLocalPipe = null;
        this.rParentPipe = null;
        this.parentTimeout = null;

        // Local Redis Configuration
        this.rBcaster.config(['set', 'protected-mode', 'no']);
        this.rLogListener.config(['set', 'notify-keyspace-events', 'KEA']);

        // Listen for all key space events and process them
        this.rLogListener.psubscribe('__keyevent*');
        this.rLogListener.on('pmessage', JAMDatasource.listenerEvent);

        // Trigger ebus event depending on local redis connection state
        this.rLogListener.on('connect', function () {
            ebus.dataUp(localHost, localPort)
        });
        this.rLogListener.on('end', function () {
            ebus.dataDown()
        });
        this.rLogListener.on('error', function () {
            ebus.dataDown()
        });
    }


    /********************************************
     **************** CONNECTION ****************
     ********************************************/

    /**
     * TODO: Error Handling
     * Creates and returns a client connection to Redis
     * @param {String} host : String
     * @param {int} port : int
     * @returns {RedisClient}
     */
    connectRedis(host, port, addOpt) {
        let options = {
            host: host,
            port: port,
            "return_buffers": true,
        }
        if (addOpt) {
            options = Object.assign(options, addOpt)
        }      // Append any additional options

        let redis = Redis.createClient(options);
        redis.on('end', () => {
        });
        redis.on('error', () => {
        });

        return redis;
    }

    /**
     * TODO: Remove hard coded retry time
     * Creates client connection to parent Redis, triggered by event bus "UP" event
     * @param {String} host
     * @param {int} port
     */
    parentUp(host, port) {
        let self = this;
        let curParentCon = {
            host: host,
            port: port
        };

        this.parentCon = curParentCon;

        // Establish parent connection for SUBSCRIBE and logging

        let rBcastListener = this.connectRedis(host, port, {
            retry_strategy: function (options) {
                // Quit old client connection if parent connection info changed
                if (self.parentCon !== curParentCon) {
                    rBcastListener.quit();
                    return;
                }
                return 3000;    // Retry time interval
            }
        })
        let rParentLogger = this.connectRedis(host, port, {
            retry_strategy: function (options) {
                if (self.parentCon !== curParentCon) {
                    rParentLogger.quit();
                    return;
                }
                return 3000;
            }
        })

        this.rBcastListener = rBcastListener;
        this.rParentLogger = rParentLogger;

        JAMBroadcaster.parentUpSub();               // Notify JAMBroadcasters to resubscribe
    }


    /********************************************
     **************** BROADCASTING **************
     ********************************************/

    /**
     * Broadcast data through `PUBLISH` with local Redis
     * @param {String} domain
     * @param {Object} message
     */
    broadcastData(domain, message) {
        this.rBcaster.publish(domain, JSON.stringify(message));
    }

    /**
     * Listen for data through `SUBSCRIBE` with parent Redis
     * @param {String} domain
     * @param {callback} callback
     */
    subscribeData(domain, callback) {
        if (this.rBcastListener) {
            this.rBcastListener.subscribe(domain);
            this.rBcastListener.on('message',
                function (channel, message) {
                    callback(channel, JSON.parse(message.toString()))
                });
        }
    }


    /********************************************
     ***************** LOGGING ******************
     ********************************************/

    /**
     * TODO: Consider preventing redundant cbor encoding when logging locally
     * Log data to local or parent Redis
     * @param {String} key
     * @param {int} timestamp
     * @param {value, timestamp} entry
     * @param {callback} callback
     * @param {boolean} isLocal
     */
    logData(key, timestamp, entry, callback, isLocal) {
        let cbMessage = isLocal ? "Data Added!" : "Process Completed";

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
                    if (callback) {
                        callback({
                            status: true,
                            message: cbMessage,
                            timestamp: timestamp
                        });
                    }
                }, 0);
            }
        };

        // Log to the respective Redis through a pipeline
        if (isLocal) {
            if (this.rLocalPipe == null) {
                this._createPipe(true);
            }
            this.rLocalPipe.xadd([key, timestamp, timestamp, entry], cb);
        } else if (this.rParentLogger) {
            if (this.rParentPipe == null) {
                this._createPipe(false);
            }
            this.rParentPipe.xadd([key, timestamp, timestamp, entry], cb)
        }
    }

    /**
     * TODO: Consider manual timestamping to avoid .replace() or use XREAD but might be bad performance?
     * XRANGE a given stream for entries after the given timestamp
     * @param {String} key
     * @param {String} lastTimestamp
     * @param dataHandlerCB - Callback for queried data
     * @param queryCompleteCB - Callback for completing queries
     */
    queryDataAfter(key, lastTimestamp, dataHandlerCB, queryCompleteCB) {
        // Increment lastTimestamp's sequence number by 1 to prevent reading duplicated value
        lastTimestamp = lastTimestamp.replace(/-\d+$/, function(n){ return '-'+(1-n) });

        this.rLocalLogger.xrange([key, lastTimestamp, "+"],
            function (error, result) {
                if (error) {
                    queryCompleteCB(true);
                    throw error;
                } else {
                    if (result !== null) {
                        // TODO: Consider accumulating replies to array vs one by one
                        /* Iterate through and decode each queried response
                         * Format of the result:
                         * [
                         *  [ <key>, [[<ID>, [<field> <value> ...],
                         *            [<ID>, [<fjeld> <value> ...],
                         *            ...
                         *           ]
                         *  ]
                         * ]
                         */
                        let log = [];
                        let time = [];
                        for (let i = 0; i < result.length; i++) {
                            time.push(result[i][0].toString());      // Get the ID
                            log.push(result[i][1][1]);               // Get the value
                            // Check if object is JSON
                        }
                        dataHandlerCB(log, time);
                    }
                }
                queryCompleteCB(false);
            });
    }

    /**
     * Changes the time interval between pipeline EXEC
     * @param {int} time
     */
    setExecTime(time) {
        this.execTime = time;
    }

    /**
     * Creates pipeline that automatically calls EXEC after set amount time
     * @param {boolean} isLocal
     */
    _createPipe(isLocal) {
        let self = this;
        if (isLocal) {
            this.rLocalPipe = this.rLocalLogger.batch();
            setTimeout(function () {
                self.rLocalPipe.exec();
                self.rLocalPipe = null;
            }, this.execTime)
        } else {
            this.rParentPipe = this.rParentLogger.batch();
            // Keep the timeout variable for cancelling
            this.parentTimeout = setTimeout(function () {
                self.rParentPipe.exec();
                self.rParentPipe = null;
            }, this.execTime)
        }
    }


    /********************************************
     ********** SENTINEL (Experimental) **********
     ********************************************/

    /**
     * TODO: Potential failure to prevent booting master as replica?
     * TODO: Move to jamsentinel
     * Handler for failover completion
     * @param channel : String
     * @param message : String
     * @private
     */
    _failoverHandler(channel, message) {
        // Stop upcoming .exec() and reset the pipe
        if (this.parentTimeout) {
            clearTimeout(this.parentTimeout);
            this.rParentPipe = null;
        }

        // Parse message to get the new host:port
        let info = message.toString().split(' ');
        let name = info[0];
        let newHost = info[3];
        let newPort = parseInt(info[4]);

        // Remove failed master from replicas
        this.rSentinel.send_command("SENTINEL", ["RESET", name]);

        // Update new parent connection
        this.parentUp(newHost, newPort);

        JAMDatastream.failoverEvent();
    }
}

module.exports = JAMRedis;