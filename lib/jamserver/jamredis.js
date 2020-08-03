const cbor = require('cbor');
const ebus = require('./ebus')
const Redis = require('redis');

class JAMRedis {
    /**
     * @param host : String
     * @param port : int
     */
    constructor(host, port, logCB) {
        // Connection host and port object of local and parent Redis
        this.localCon = {
            host: host,
            port: port
        }
        this.parentCon = null;

        // Pipeline EXEC time
        this.execTime = 3000;

        // Dedicated Redis clients for broadcasting and listening
        this.rBcastListener = null;
        this.rBcaster = this.connectLocalRedis(host, port);         // TODO: Include PUBLISHER into pipeline
        this.rBcaster.config(['set', 'protected-mode', 'no']);      // TODO: Consider the race condition of setting this config

        // Dedicated Redis clients for logging and listening
        this.rPipe = null;
        this.rLogger = null;
        this.rLocalPipe = null;
        this.rLocalLogger = this.connectLocalRedis(host, port);
        this.rLogListener = this.connectLocalRedis(host, port);
        this.rLogListener.config(['set', 'notify-keyspace-events', 'KEA']);     // Configuration for listening to key event notf

        // listen for all events for all keys and process them in the listenerEvent function
        this.rLogListener.psubscribe('__keyevent*');
        this.rLogListener.on('pmessage', logCB);

        this.rLogListener.on('connect', function () {
            ebus.dataUp(host, port);
        });

        this.rLogListener.on('end', function () {
            ebus.dataDown();
        });

        this.rLogListener.on('error', function () {
            ebus.dataDown();
        });

    }


    /***** CONNECTION *****/

    /**
     * Creates connection to local Redis
     * @param host : String
     * @param port : int
     * @returns {RedisClient}
     */
    connectLocalRedis(host, port) {
        let redis = Redis.createClient({
            host: host,
            port: port,
            "return_buffers": true
        });

        // TODO: Add listening event

        return redis;
    }

    /**
     * Creating connection to parent Redis for broadcasting and logging, triggered by event bus "UP" event
     * @param host : String
     * @param port : int
     */
    parentUp(host, port) {
        this.parentCon = {
            host: host,
            port: port
        };

        /* Establish parent connection for SUBSCRIBE */
        this.rBcastListener = Redis.createClient({
            host: host,
            port: port,
            "return_buffers": true
        });
        this.rBcastListener.on('end', function () {
            //parentConObj = null;
        });
        this.rBcastListener.on('error', function () {
            //parentConObj = null;
        });

        /* Establish parent connection for writes */
        this.rLogger = Redis.createClient({
            host: host,
            port: port,
            "return_buffers": true
        });
        this.rLogger.on('end', function () {
            //parentConObj = null;
        });
        this.rLogger.on('error', function () {
            //parentConObj = null;
        });
    }

    parentDown() {
        if (this.rLogger !== undefined && this.rLogger !== null)
            this.rLogger.quit();

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
        this.rBcaster.publish(domain, cbor.encode(message));
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
                    callback(channel, cbor.decodeFirstSync(message))
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
    async logData(key, timestamp, entry, callback, isLocal) {
        let cbMessage = '';
        if (isLocal) {
            cbMessage = 'Data added!';
        } else {
            cbMessage = 'Process completed!';
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
            this.rLocalLogger.xadd([key, timestamp, timestamp, cbor.encode(entry)], cb);
        } else if (this.rLogger) {
            if (this.rPipe == null) {
                this._createPipe(false);
            }
            this.rPipe.xadd([key, timestamp, timestamp, cbor.encode(entry)], cb)
        }
    }

    /**
     * Creates pipeline that automatically calls EXEC after set amount time
     * @param isLocal : boolean
     * @private
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
            this.rPipe = this.rLogger.batch();
            setTimeout(async function () {
                self.rPipe.exec();
                self.rPipe = null;
            }, this.execTime)
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
        this.rLocalLogger.xread(['STREAMS', key, lastTimestamp],
            function (error, result) {
                if (error) {
                    queryCompleteCB(true);
                    throw error;
                } else {
                    if (result != null) {
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
                            let log = cbor.decodeFirstSync(result[0][1][i][1][1]);
                            let timestamp = (result[0][1][i][1][0]).toString();
                            dataHandlerCB(log, timestamp);
                        }
                    }
                }
                queryCompleteCB(false);
            });
    }
}

module.exports = JAMRedis;