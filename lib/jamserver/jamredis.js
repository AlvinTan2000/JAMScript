var Redis = require('redis');

class JAMRedis {

    constructor(host, port) {
        console.log("Creating JAMRedis")

        this.localCon = {
            host: host,
            port: port
        }
        this.parentCon = null;

        this.test = "test";
        this.redisPub = this.connectLocalRedis(host, port);
        this.redisPub.config(['set', 'protected-mode', 'no']);

        this.redisSub = null;
    }


    getParentCon(){
        return this.parentCon;
    }

    // TODO: Add listening event
    connectLocalRedis(host, port) {
        console.log("Connect Local Redis")

        let redis = Redis.createClient({
            host: host,
            port: port,
            "return_buffers": true
        });


        return redis;
    }

    /**
     * Ebus event triggered
     * @param host : String
     * @param port : int
     */
    parentUp(host, port) {
        this.parentCon = {
            host: host,
            port: port
        };

        this.redisSub = Redis.createClient({
            host: host,
            port: port,
            "return_buffers": true
        });

        this.redisSub.on('end', function () {
            //parentConObj = null;
        });

        this.redisSub.on('error', function () {
            //parentConObj = null;
        });
    }

    /**
     * Broadcast data through `PUBLISH` with local Redis
     * @param domain : String
     * @param message : Object
     */
    broadcastData(domain, message) {
        this.redisPub.publish(domain, message);
    }

    /**
     * Listen for data through `SUBSCRIBE` with parent Redis
     * @param domain : String
     * @param callback : callback
     */
    subscribeData(domain, callback) {
        if (this.redisSub) {
            this.redisSub.subscribe(domain);
            this.redisSub.on('message', callback);
        }
    }
}

module.exports = JAMRedis;