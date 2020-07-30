var Redis = require('redis');
var ebus = require('./ebus')
var JAMDatasource = require('./jamdatasource')

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
        this.rLogListener.config(['set', 'notify-keyspace-events', 'KEA']);

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

    /**
     * @returns {host, port}
     */
    getParentCon(){
        return this.parentCon;
    }

    /**
     * Creates connection to local Redis
     * @param host : String
     * @param port : int
     * @returns {RedisClient}
     */
    connectLocalRedis(host, port) {
        console.log("Connect Local Redis")

        let redis = Redis.createClient({
            host: host,
            port: port,
            "return_buffers": true
        });

        // TODO: Add listening event

        return redis;
    }

    /**
     * Creating parent Redis connections triggered by event bus "UP" event
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


    /****** Logging *****/
    logData (key, curTime, entry, callback,isLocal){
        if (isLocal) {
            this.rLocalLogger.zadd([key, curTime, entry], callback);
        }
        else{
            this.rLogger.zadd([key, curTime, entry], callback)
        }
    }

}

module.exports = JAMRedis;