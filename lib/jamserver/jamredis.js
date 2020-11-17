const ebus = require('./ebus')
const cbor = require("cbor")
const Redis = require('redis');
const {promisify} = require("util");
const JAMBroadcaster = require('./jambroadcaster');
const JAMDatasource = require('./jamdatasource')
const JAMDatastream = require('./jamdatastream')

// TODO: Implement seperate garbage collection for streams

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


        /* Sentinel Handling (Experimental) */
        this.rSentinel = null;       // Sentinel connection
        this.setSentinel("127.0.0.1", 26379);
        this.setMaster("127.0.0.1", 7000, null, "master@8001", 2);
        // this.setSlave("127.0.0.1", 7000, null, "master@7000");

        // Hard coded to connect sentinel at 127.0.0.1:30001
        if (localPort == 8000) {
            this.rSenListener = this.connectRedis("127.0.0.1", 30001)
            this.rSenListener.subscribe("+switch-master")
            this.rSenListener.on("message", this._failoverHandler.bind(this))
        }
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
    connectRedis(host, port, addOpt, callback) {
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
            this.rLocalLogger.xadd([key, timestamp, timestamp, cbor.encode(entry)], cb);
        } else if (this.rParentLogger) {
            if (this.rParentPipe == null) {
                this._createPipe(false);
            }
            this.rParentPipe.xadd([key, timestamp, timestamp, cbor.encode(entry)], cb)
        }
    }

    /**
     * XREAD a given stream for entries after the given timestamp
     * @param {String} key
     * @param {int} lastTimestamp
     * @param {callback} dataHandlerCB - Callback for queried data
     * @param {callback} queryCompleteCB - Callback for completing queries
     */
    queryDataAfter(key, lastTimestamp, dataHandlerCB, queryCompleteCB) {
        this.rLocalLogger.xread(['STREAMS', key, lastTimestamp],
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
                        for (let i = 0; i < result[0][1].length; i++) {
                            let timestamp = result[0][1][i][1][0].toString();      // Get the ID
                            let log = cbor.decodeFirstSync(result[0][1][i][1][1]).value;         // Get the value
                            // Check if object is JSON
                            dataHandlerCB(log, timestamp);
                        }
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
     * TODO: Expand more than one sentinel connection
     * Sets the connection to the sentinel
     * @param {String }host
     * @param {int} port
     * @param callback - (Optional) callback when connection to sentinel is ready
     */
    setSentinel(host, port, callback) {
        this.rSentinel = this.connectRedis(host, port, null, callback);
        if (callback) {
            callback();
        }
    }

    /**
     * Sets Redis instance to be a master, optionally make the sentinel to monitor it
     * @param {String} host
     * @param {int} port
     * @param callback - callback when master is ready
     * @param {String} monitorName - (Optional) name of monitor group
     * @param {int} quorum - (Optional) quorum for the failover
     */
    setMaster(host, port, callback, monitorName, quorum) {
        let self = this;
        let cb = callback;

        // Make sentinel monitor the master/replica group if name and quorum are specified
        if (monitorName && quorum) {
            cb = () => {
                self.rSentinel.send_command("SENTINEL", ["MONITOR", monitorName, host, port, quorum],
                    (error, result) => {
                        // Check for duplicated master name error, else continue user callback if specified
                        if (error) {
                            console.log(error);
                        } else if (callback) {
                            callback();
                        }
                    })
            }
        }

        // Connect to the specific Redis and send the command "SLAVEOF NO ONE"
        let redis = this.connectRedis(host, port);
        redis.send_command("SLAVEOF", ["NO", "ONE"], this._setMasterCB(redis, "", cb));
    }

    _setMasterCB(redis, result, callback) {
        let self = this;

        // parse reply
        let reply = result.toString().split(",");

        // Recursively poll for the information until reply is valid and ROLE indicates "MASTER"
        if (reply.length < 2 || reply[0] != "master") {
            redis.role((error, result) => {
                self._setMasterCB(redis, result, callback);
            });
        }
        // Else initiate callback then close the connection
        else {
            if (callback) {
                callback();
            }
            redis.quit();
        }
    }

    /**
     * Sets Redis instance to be a slave of another instance
     * @param {String} host
     * @param {int} port
     * @param {String} targetHost
     * @param {int} targetPort
     * @param {callback} callback -  called whenever the slave is ready
     */
    setSlave(host, port, targetHost, targetPort, callback) {
        let self = this;

        // Connect to the desired Redis and send command "SLAVEOF HOST IP"
        let redisS = this.connectRedis(host, port);
        redisS.send_command("SLAVEOF", [targetHost, targetPort], () => {
            // Connect to the master Redis to poll the replication ID of the current moment
            let redisM = self.connectRedis(targetHost, targetPort);
            redisM.role((error, result) => {
                let reply = result.toString().split(",");
                let replicationOffset = reply[1];
                self._setSlaveCB(redisS, replicationOffset, "", callback);
            })
        });


    }

    _setSlaveCB(redisS, replication, result, callback) {
        let self = this;

        // Parse reply
        let reply = result.toString().split(",");
        // Recursively poll until reply is valid and is replicated "enough"
        if (reply.length < 2 || reply[4].toString() < replication) {
            redisS.role((error, result) => {
                self._setSlaveCB(redisS, replication, result, callback)
            });
        }
        // Else initiate callback then close the connection
        else {
            if (callback) {
                callback();
            }
            redisS.quit();
        }
    }

    /**
     * Get the last entry ID of the stream
     * @param key : String
     * @param callback : function
     * @returns {Promise<T | void>}
     */
    xinfoSync(key) {
        let XINFO = promisify(this.rParentLogger.xinfo).bind(this.rParentLogger);   // Promisify .xinfo()

        return XINFO('STREAM', key,)
            .then(function (reply) {
                // Convert message to dictionary
                let tempDic = {};
                for (let i = 0; i < reply.length; i += 2) {
                    tempDic[reply[i]] = reply[i + 1];
                }
                return parseInt(tempDic['last-entry'][1][0]);       // Extract last entry time
            })
            .catch(console.log)
    }

    /**
     * TODO: Potential failure to prevent booting master as replica?
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
        this.rSentinel.send_command("SENTINEL", ["REMOVE", name]);

        // Update new parent connection
        this.parentUp(newHost, newPort);

        JAMDatastream.failoverEvent();
    }
}

module.exports = JAMRedis;