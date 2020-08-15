const ebus = require('./ebus')
const Redis = require('redis');
const {promisify} = require("util");
const JAMBroadcaster = require('./jambroadcaster');
const JAMDatasource = require('./jamdatasource')
const JAMDatastream = require('./jamdatastream')

// TODO: Sentinel run time configurations

class JAMRedis {
    /**
     * @param localHost : String
     * @param localPort : int
     */
    constructor(localHost, localPort) {
        this.parentCon = null;          // Connection host and port object of parent Redis

        // Broadcaster Related
        this.rBcastListener = null;
        this.rBcaster = this.connectLocal(localHost, localPort);        // TODO: Include PUBLISHER into pipeline?

        // Logging Related
        this.rParentLogger = null;
        this.rLocalLogger = this.connectLocal(localHost, localPort);
        this.rLogListener = this.connectLocal(localHost, localPort);

        // Pipeline Related
        this.execTime = 3000;
        this.rLocalPipe = null;
        this.rParentPipe = null;

        // Configuration
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

        /* Sentinel Handling (Experimental) */
        this.timeout=null;

        if (localPort == 8001) {
            this.rSenListener = this.connectLocal("127.0.0.1", 30001)
            this.rSenListener.subscribe("+switch-master")
            this.rSenListener.on("message", this._failoverHandler.bind(this))
        }
    }


    /***** CONNECTION *****/

    // TODO: Error Handling
    /**
     * Creates and returns a client connection to local Redis
     * @param host : String
     * @param port : int
     * @returns {RedisClient}
     */
    connectLocal(host, port) {
        let redis = Redis.createClient({
            host: host,
            port: port,
            "return_buffers": true
        });

        redis.on('end', () => {
        });
        redis.on('error', () => {
        });

        return redis;
    }

    // TODO: Remove hard coded retry time
    // TODO: Abstract away redundant connection code
    /**
     * Creates client connection to parent Redis, triggered by event bus "UP" event
     * @param host : String
     * @param port : int
     */
    parentUp(host, port) {
        let self = this;
        let curParentCon = {
            host: host,
            port: port
        };

        this.parentCon = curParentCon;

        // Establish parent connection for SUBSCRIBE
        let rBcastListener = Redis.createClient({
            host: host,
            port: port,
            "return_buffers": true,
            retry_strategy: function (options) {
                // Quit old client connection if parent connection info changed
                if (self.parentCon !== curParentCon) {
                    rBcastListener.quit();
                    return;
                }
                return 3000;
            }
        });

        // Establish parent connection for writes
        let rLogger = Redis.createClient({
            host: host,
            port: port,
            "return_buffers": true,
            retry_strategy: function (options) {
                // Quit old client connection if parent connection info changed
                if (self.parentCon !== curParentCon) {
                    rLogger.quit();
                    return;
                }
                return Math.min(options.attempt * 100, 3000);
            }
        });

        // Connection Error Handling (Only handled by one of the client connection)
        rBcastListener.on('end', () => {
        });
        rBcastListener.on('error', () => {
        });
        rLogger.on('end', console.log);
        rLogger.on('error', console.log);

        this.rBcastListener = rBcastListener;
        this.rParentLogger = rLogger

        JAMBroadcaster.parentUpSub();
    }

    parentDown() {
        if (this.rParentLogger !== undefined && this.rParentLogger !== null)
            this.rParentLogger.quit();

        if (this.rBcastListener !== undefined && this.rBcastListener !== null)
            this.rBcastListener.quit();

        this.parentCon = null;
    }

    /***** Broadcasting *****/

    /**
     * Broadcast data through `PUBLISH` with local Redis
     * @param domain : String
     * @param message : Object
     */
    broadcastData(domain, message) {
        this.rBcaster.publish(domain, JSON.stringify(message));
    }

    /**
     * Listen for data through `SUBSCRIBE` with parent Redis
     * @param domain : String
     * @param callback : function (String, Object): void
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


    /****** LOGGING RELATED *****/

    /**
     * Log data to local or parent Redis
     * @param key : String
     * @param timestamp : int
     * @param entry : {value, timestamp}
     * @param callback : function(Object): void
     * @param isLocal : boolean
     */
    logData(key, timestamp, entry, callback, isLocal) {
        let cbMessage = '';
        if (isLocal) {
            cbMessage = 'Data added!';
        } else {
            // cbMessage = 'Process completed!';
            cbMessage = this.parentCon?.port;
        }

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
            this.rLocalLogger.xadd([key, timestamp, timestamp, JSON.stringify(entry)], cb);
        } else if (this.rParentLogger) {
            if (this.rParentPipe == null) {
                this._createPipe(false);
            }
            this.rParentPipe.xadd([key, timestamp, timestamp, JSON.stringify(entry)], cb)
        }
    }


    /**
     * XREAD in a stream for entries after the given timestamp, which are processed to passed to the callback
     * @param key : String
     * @param lastTimestamp : int
     * @param dataHandlerCB : function (Object, int, Object): void
     * @param queryCompleteCB : function (boolean): void
     */
    queryDataAfter(key, lastTimestamp, dataHandlerCB, queryCompleteCB) {
        console.log("query")
        this.rLocalLogger.xread(['STREAMS', key, lastTimestamp],
            function (error, result) {
                if (error) {
                    queryCompleteCB(true);
                    throw error;
                } else {
                    if (result !== null) {
                        /* Iterate through and decode each queried response
                         * Format of the result:
                         * [
                         *  [ <key>, [[<ID>, [<field> <value> ...],
                         *            [<ID>, [<fjeld> <value> ...],
                         *            ...
                         *           ]
                         *  ]
                         * ]
                         * where field : timestamp and value : Object
                         */
                        for (let i = 0; i < result[0][1].length; i++) {
                            let log = JSON.parse(result[0][1][i][1][1].toString());
                            let timestamp = result[0][1][i][1][0].toString();
                            dataHandlerCB(log, timestamp);
                        }
                    }
                }
                queryCompleteCB(false);
            });
    }


    /**
     * Creates pipeline that automatically calls EXEC after set amount time
     * @param isLocal : boolean
     */
    _createPipe(isLocal) {
        let self = this;
        if (isLocal) {
            this.rLocalPipe = this.rLocalLogger.batch();
            setTimeout(async function () {
                self.rLocalPipe.exec();
                self.rLocalPipe = null;
            }, this.execTime)
        } else {
            this.rParentPipe = this.rParentLogger.batch();
            this.timeout=setTimeout(async function () {
                self.rParentPipe.exec();
                self.rParentPipe = null;
            }, this.execTime)
        }
    }


    /****** FAULT TOLERANCE (Experimental) *****/

    /**
     * Get the last entry ID of the stream
     * @param key : String
     * @param callback : function
     * @returns {Promise<T | void>}
     */
    getXinfo(key) {
        console.log("Called xinfo")

        // Promisify .xinfo()
        let rParentLogger = this.rParentLogger;
        let XINFO = promisify(rParentLogger.xinfo).bind(rParentLogger);

        return XINFO('STREAM', key,)
            .then(function (reply) {
                // Convert message to dictionary
                let tempDic = {};
                for (let i = 0; i < reply.length; i += 2) {
                    let key = reply[i];
                    let value = reply[i + 1];
                    tempDic[key] = value;
                }

                let lastEntryTime = parseInt(tempDic['last-entry'][1][0]);       // Extract last entry time

                console.log("xinfo reply", tempDic['last-entry'][1][1].toString(), lastEntryTime);

                return (lastEntryTime);
            })
            .catch(console.log)
    }


    _failoverHandler(channel, message) {
        clearTimeout(this.timeout);             // Stop .exec()
        this.rParentPipe = null;

        // Split message by spaces
        let info = message.toString().split(' ');
        let newHost = info[3];
        let newPort = parseInt(info[4]);

        this.parentUp(newHost, newPort);        // Update new parent connection

        JAMDatastream.failoverEvent();

    }
}

module.exports = JAMRedis;