const {promisify} = require("util");
const Redis = require('redis');

class JAMSentinel{

    constructor() {
        /* Sentinel Handling (Experimental) */
        this.rSentinel = null;       // Sentinel connection
        this.rSenListener = null;
    }

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
     * TODO: Expand more than one sentinel connection
     * Sets the connection to the sentinel
     * @param {String }host
     * @param {int} port
     * @param callback - (Optional) callback when connection to sentinel is ready
     */
    setSentinel(host, port, callback) {
        this.rSentinel = this.connectRedis(host, port, null);
        this.rSenListener = this.connectRedis(host, port, null);

        // Hard coded to connect sentinel at 127.0.0.1:30001
        this.rSenListener.subscribe("+switch-master")
        this.rSenListener.on("message", this._failoverHandler.bind(this))

        if (callback) {
            callback();
        }
    }

    /**
     * TODO: remove the SLAVOEF no one as it is redundant
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
                redisM.quit();
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
     * TODO: Potential failure to prevent old master booting as replica?
     * Handler for failover completion
     * @param channel : String
     * @param message : String
     * @private
     */
    _failoverHandler(channel, message) {
        // Parse message to get the new host:port
        let info = message.toString().split(' ');
        let name = info[0];

        // Remove failed master from replicas
        this.rSentinel.send_command("SENTINEL", ["RESET", name]);
    }
}

module.exports = JAMSentinel;