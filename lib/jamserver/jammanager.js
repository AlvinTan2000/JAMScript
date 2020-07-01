/**
 * This file listens for events in the key space and takes the required action. It also
 */

let Redis = require('redis');
let JAMDatastream = require('./jamdatastream');
let ebus = require('./ebus');

let jamdatastream_callbacks = {};
let jamdatasources = {};
let initalizing = true;
let debug = false;

const globals = require('./constants').globals;


module.exports = function (cmdopts, jsys) {
    let host = cmdopts.redhost;
    let port = cmdopts.redport;
    let pack = {};  //the object to return
    /**
     * Each element in the jamdata is a pair of key => jamdatastream.
     * Sample: key: jamdatastream: ...
     * key is the unique key which would receive the storage elements or act as the subscription handle/tag
     * object is a JAMDatastream object
     * @type {Object}
     */
    let jamdatastreams = {};
    let msg_receive_callback;

    // this would listen for all keyspace events (using the keyevent notification mechanism) and channel it to the right jamdatastream
    let listener = Redis.createClient({
        host: host,
        port: port,
        "return_buffers": true
    });

    // this is the handle that would be passed to all instances of the JAMDatastream for making a call to the Redis server
    let executor = Redis.createClient({
        host: host,
        port: port,
        "return_buffers": true
    });

    // Mahesh: This will run every time redis server is reconnected..
    listener.on('connect', function () {

        //     jamsys.setRedis(host, port);
        ebus.dataUp(host, port);
        //     jamsys.adUp('datadepot', {host: host, port: port});
    });

    // // Mahesh: This will run every time redis server is disconnected..
    listener.on('end', function () {
        //     jamsys.adDown('datadepot');
        ebus.dataDown();
    });

    listener.on('error', function () {
        //     jamsys.adDown('datadepot');
        ebus.dataDown();
    });

    //This will hold a connection to the redis of the parent of the current level in the hierarchy.
    //For e.g device->Fog; fog->Cloud
    let parentRedis = null; //This is for broadcaster. first default to null. connectToParent method will set the connection
    let parentRedisLogger = null;   //This is for logging data to the parent

    //This holds all listeners for data/event changes on Redis
    //Each listener subscribes to a particular key which will be accessible via listeners.{key}
    //listeners.{key} is an array of all listeners subscribing to that data changes in that key
    let listeners = {};

    let broadcasters = [];  //this keeps track of all broadcasters

    // TODO check if the redis connection was successful before attempting to query the redis server

    let parentRedisInfo = null;    //the data retrieved from listening to the parent advertisement on their IP address
    let parentStatusListeners = [];

    ebus.on('fog-data-up', function (info) {
        console.log("Fog Data Up -------------------------", info, parentRedisInfo);
        if (pack.isDevice && (parentRedisInfo === null || parentRedisInfo.host != info.host || parentRedisInfo.port != info.port))
            doConnectToParent(info);
    });

    ebus.on('fog-data-down', function () {

        if (pack.isDevice && (parentRedisInfo !== null))
            doDisconnectFromParent();
    });

    ebus.on('cloud-data-up', function (info) {
        console.log("Cloud Data Up ------------------------XXXXX", info);
        if (pack.isFog && (parentRedisInfo === null || parentRedisInfo.host != info.host || parentRedisInfo.port != info.port))
            doConnectToParent(info);
    });

    ebus.on('cloud-data-down', function () {

        if (pack.isFog && (parentRedisInfo !== ull))
            doDisconnectFromParent();
    });

    function doConnectToParent(info) {
        parentRedisInfo = info;
        parentRedis = pack.connectToParent(info.host, info.port);
        parentRedisLogger = pack.connectToParent(info.host, info.port);
        parentStatusListeners.forEach(function (obj) {
            obj.func.call(obj.context, info, parentRedis);
        });

        parentRedis.on('error', function () {
            //parentRedisInfo = null;
        });

        parentRedisLogger.on('error', function () {
            //parentRedisInfo = null;
        });

        parentRedis.on('end', function () {
            //parentRedisInfo = null;
        });

        parentRedisLogger.on('end', function () {
            //parentRedisInfo = null;
        });
    }

    function doDisconnectFromParent() {

        if (parentRedis !== undefined && parentRedis !== null) {
            parentRedis.quit();
        }
        if (parentRedisLogger !== undefined && parentRedisLogger !== null)
            parentRedisLogger.quit();
        parentRedisInfo = null;
    }

    //'__keyevent@*:*'
    function init() {
        console.log("Created JAMManager");
        // Turn on notify events for:
        // E: Keyspace events
        // z: Sorted sets
        listener.config(['set', 'notify-keyspace-events', 'KEA']);

        // // Allows other machine to access redis clients on this one.
        //    listener.rawCall(['config', 'set', 'protected-mode', 'no']);
        //    executor.rawCall(['config', 'set', 'protected-mode', 'no']);

        //listen for all events for all keys and process them in the listenerEvent function
        listener.psubscribe('__keyevent*');
        listener.on('pmessage', listenerEvent);
    }

    function listenerEvent(pat, ch, bufferData) {
        let data = bufferData.toString();

        if (data !== undefined) {

            if (jamdatastream_callbacks[data] != undefined) {
                // msg_receive_callback(data);
                let jamdatastream = jamdatastream_callbacks[data];
                jamdatastream.set_size++;
                if (jamdatastream.refresh_rate === 0) {
                    jamdatastream.request_value_refresh();
                }
            } else {
                let idx = data.lastIndexOf('.');
                if (idx !== -1) {
                    let jamdatasource_key = data.substring(0, idx);
                    let jamdatasource = jamdatasources[jamdatasource_key];
                    if (jamdatasource != undefined) {
                        idx = data.lastIndexOf('[');
                        let deviceId = data.substring(idx + 1, data.length - 1);
                        jamdatasource.addDatastream(deviceId);
                        let jamdatastream = jamdatastream_callbacks[data];
                        jamdatastream.set_size++;
                        if (jamdatastream.refresh_rate === 0) {
                            jamdatastream.request_value_refresh();
                        }
                    }
                }
            }

            //notify all listeners for this message on the current key
            if (listeners[data]) { //there are listeners listening on this key

                let keyObject = buildKeyObject(data);

                for (let listener of listeners[data]) {
                    if (listener.notify && typeof listener.notify === 'function')
                        listener.notify.call(listener, keyObject);
                    else if (typeof listener === 'function')
                        listener.call({}, keyObject);
                }
            }
        }
    }

    //Used to build subscription key for Apps that subscribe with Objects
    function buildKey(obj) {
        let key = 'aps[' + obj.app + ']';
        if (obj.namespace)
            key = key + '.ns[' + obj.namespace + ']';
        if (obj.flow)  //for OutFlow and InFlow
            key = key + '.flow[' + obj.flow + ']';
        if (obj.datasource)
            key = key + '.ds[' + obj.datasource + ']';
        if (obj.datastream)
            key = key + '.dts[' + obj.datastream + ']';

        return key;
    }

    //Used to rebuild subscription key back to Objects
    function buildKeyObject(key) {
        let obj = {}, content;

        let parts = key.split(".");

        for (let part of parts) {
            content = part.substring(part.indexOf("[") + 1, part.indexOf("]"));

            if (part.startsWith("aps"))
                obj.app = content;
            else if (part.startsWith("ns"))
                obj.namespace = content;
            else if (part.startsWith("flow"))
                obj.flow = content;
            else if (part.startsWith("ds"))
                obj.datasource = content;
            else if (part.startsWith("dts"))
                obj.datastream = content;
        }

        return obj;
    }

    init();

    pack = {
        app: cmdopts.app,
        redis: executor,

        isDevice: cmdopts.device,
        isFog: cmdopts.fog,
        isCloud: cmdopts.cloud,

        deviceID: jsys.id,
        fullID: jsys.id + "_" + jsys.type,

        add_jamdatasource: function (jamdatasource) {
            if (jamdatasource === undefined) {
                throw new Error("Undefined jamdatasource");
            }
            jamdatasources[jamdatasource.key] = jamdatasource;
        },

        add_jamdatastream: function (jamdatastream) {
            if (jamdatastream === undefined) {
                throw new Error("Undefined jamdatastream");
            }
            jamdatastream.redis = executor;
            jamdatastream_callbacks[jamdatastream.key] = jamdatastream;
        },

        delete_jamdatastream: function (key) {
            if (jamdatastream_callbacks[key])
                delete jamdatastream_callbacks[key];
        },

        log: function (key, value, slots, appID, deviceID) {
            let jamdatastream;
            // Check if we already have a key saved in the array
            if (jamdatastreams[key]) {
                jamdatastream = jamdatastreams[key].jamdatastream;
            } else { // a new key
                jamdatastream = new JAMDatastream(key, slots, executor);
                jamdatastreams[key] = jamdatastream;
            }

            jamdatastream.log(value,
                /** @param {{status:boolean, error: String, message: String}} response **/
                function (response) {
                    // TODO: Callback is doing nothing? Why take an object when you can pass two things?
                });
        },

        simpleLog: function (key, value, callback, redis, timestamp) {
            console.log("JAMManager simpleLog");

            redis = redis ? redis : redisExecutor;

            // Create new simple callback
            let cb = function (e, d) {
                if (e) {
                    if (callback) {
                        callback({
                            status: false,
                            error: e
                        });
                    }
                } else if (callback) {
                    (function (time) {
                        setTimeout(function () {
                            callback({
                                status: true,
                                message: 'Process Completed Successfully!',
                                timestamp: time
                            });
                        }, 0);
                    })(timestamp);
                }
            };

            redis.zadd([key, timestamp, value], cb);
        },

        subscribe: function (key, listener) {
            // Convert key to string if it is an object
            if (Boolean(key) && typeof key === 'object')
                key = buildKey(key);

            // Add listener to the appropriate list
            if (listeners[key])
                listeners[key].push(listener);
            else
                listeners[key] = [listener];
        },

        unsubscribe: function (key, listener) {
            // Convert key to string if it is an object
            if (Boolean(key) && typeof key === 'object')
                key = buildKey(key);

            // Find the appropriate listener and remove it
            if (listeners[key]) {
                let i = 0;
                for (let l of listeners[key]) {
                    if (l == listener)
                        listeners[key].splice(i, 1);
                    i++;
                }
            }
        },

        buildKey: buildKey,

        buildKeyObject: buildKeyObject,

        getRedisHost() {
            return host;
        },

        getRedisPort() {
            return port;
        },

        getParentRedis: function () {
            return parentRedis;
        },

        getParentRedisLogger: function () {
            return parentRedis;
        },

        connectToParent(ip, port) {
            return Redis.createClient({
                host: ip,
                port: port,
                "return_buffers": true
            });
        },


        getLevelCode: function () {
            return pack.isDevice ? "device" : pack.isFog ? "fog" : "cloud";
        },

        /**
         * @param {{func: function(), context: JAMBroadcaster}} obj
         */
        addParentUpSub: function (obj) { //add parent up subscription
            parentStatusListeners.push(obj);
        },

        getParentInfo: function () {
            return parentRedisInfo;
        },

        addBroadcaster: function (broadcaster) {
            broadcasters.push(broadcaster);
        },

        getClock: function () {
            //go through all the broadcasters and get the max clock
            if (broadcasters.length === 0)
                return null;
            let max = {clock: broadcasters[0].clock, subClock: broadcasters[0].subClock};

            for (let broadcaster of broadcasters) {
                if (broadcaster.clock > max.clock || (broadcaster.clock == max.clock && broadcaster.subClock > max.subClock)) {
                    max.clock = broadcaster.clock;
                    max.subClock = broadcaster.subClock;
                }
            }
            //we are returning it as: "2310" or "2310,2"
            return max.clock + '.' + max.subClock;
        },
        host: host,
        port: port
    };

    return pack;
}

