const cbor = require('cbor');
const ebus = require('./ebus')
const Redis = require('redis');
const JAMDatasource = require('./jamdatasource')

class JAMRedis {
    /**
     * @param host : String
     * @param port : int
     */
    constructor(host, port) {
        // Connection host and port object of local and parent Redis
        this.localCon = {
            host: host,
            port: port
        }
        this.parentCon = null;

        // Dedicated Redis clients for broadcasting and listening
        this.rBcastListener = null;
        this.rBcaster = this.connectLocalRedis(host, port);         // TODO: Include PUBLISHER into pipeline
        this.rBcaster.config(['set', 'protected-mode', 'no']);      // TODO: Consider the race condition of setting this config

        // Dedicated Redis clients for logging and listening
        this.rLogger = null;                                        // TODO: Pipeline the logging
        this.rLocalLogger = this.connectLocalRedis(host, port);
        this.rLogListener = this.connectLocalRedis(host, port);
        this.rLogListener.config(['set', 'notify-keyspace-events', 'KEA']);     // Configuration for listening to key event notf

        // listen for all events for all keys and process them in the listenerEvent function
        this.rLogListener.psubscribe('__keyevent*');
        this.rLogListener.on('pmessage', JAMDatasource.listenerEvent);

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
        this.rBcaster.publish(domain, message);
    }

    /**
     * Listen for data through `SUBSCRIBE` with parent Redis
     * @param domain : String
     * @param callback : callback
     */
    subscribeData(domain, callback) {
        if (this.rBcastListener) {
            this.rBcastListener.subscribe(domain);
            this.rBcastListener.on('message', callback);
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

        // Locally to-be-logged entries require CBOR encoding, while upper to-be-logged are already CBOR encoded
        if (isLocal) {
            this.rLocalLogger.xadd([key, timestamp, timestamp, cbor.encode(entry)], cb);
        } else if (this.rLogger) {
            this.rLogger.xadd([key, timestamp, timestamp, cbor.encode(entry)], cb)
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
                    if (result !== undefined) {
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