let Redis = require('redis');
let JAMDatastream = require('./jamdatastream');
let ebus = require('./ebus');

let jamdatastream_callbacks = {};      // TODO: What is this? Different to jamdatastream_list ?
let jamdatasource_list = {};

/**
 * @param {command-line-args} cmdopts
 * @param {JSys} jsys
 */
module.exports = function (cmdopts, jsys) {
    let pack = {};                      // Object to return

    let host = cmdopts.redhost;
    let port = cmdopts.redport;

    // Connection to the redis of the upper level in the hierarchy
    let parentRedisInfo = null;
    let parentRedisLogger = null;
    let parentRedisBroadcaster = null;
    let parentStatusListeners = [];     // TODO: What is this

    // TODO: What kind of listeners are these?
    let redisListener_list = {};    // Holds all Redis 'listener' for each key, accessible via listener_list.{key}
    let broadcasters = [];          // Keeps track of all broadcasters
    let jamdatastream_list = {};    // TODO: Why the different scope between jamdatasource_list and jamdatastream_list

    let msg_receive_callback;

    // TODO: Check if the redis connection was successful before attempting to query the redis server
    // Listener for keyspace events and channel it to the right JAMDatastream
    let redisListener = Redis.createClient({
        host: host,
        port: port,
        "return_buffers": true
    });
    // Executor to be passed to all instances of the JAMDatastream for making Redis server calls
    let redisExecutor = Redis.createClient({
        host: host,
        port: port,
        "return_buffers": true
    });


    // TODO: Should look into the commented code in the event emitters
    // Note: Will run every time redis server is reconnected..
    redisListener.on('connect', function () {
        //     jamsys.setRedis(host, port);
        ebus.dataUp(host, port);
        //     jamsys.adUp('datadepot', {host: host, port: port});
    });
    // Note: Will run every time redis server is disconnected..
    redisListener.on('end', function () {
        //     jamsys.adDown('datadepot');
        ebus.dataDown();
    });
    redisListener.on('error', function () {
        //     jamsys.adDown('datadepot');
        ebus.dataDown();
    });

    ebus.on('fog-data-up', function (info) {
        console.log("Fog Data Up -------------------------", info, parentRedisInfo);
        if (pack.isDevice && (parentRedisInfo === null || parentRedisInfo.host !== info.host || parentRedisInfo.port !== info.port))
            connectParentRedis(info);
    });
    ebus.on('fog-data-down', function () {

        if (pack.isDevice && (parentRedisInfo !== null))
            disconnectParentRedis();
    });
    ebus.on('cloud-data-up', function (info) {
        console.log("Cloud Data Up ------------------------XXXXX", info);
        if (pack.isFog && (parentRedisInfo === null || parentRedisInfo.host != info.host || parentRedisInfo.port != info.port))
            connectParentRedis(info);
    });
    ebus.on('cloud-data-down', function () {

        if (pack.isFog && (parentRedisInfo !== null))
            disconnectParentRedis();
    });


    function init() {
        // Turn on events notifications (Refer to redis.conf for events notified based on the chars.)
        redisListener.config('SET', ['notify-keyspace-events', 'AKE']);

        // Allows other machine to access the redis clients
        // listener.rawCall(['config', 'set', 'protected-mode', 'no']);
        // executor.rawCall(['config', 'set', 'protected-mode', 'no']);

        // Subscribe for all events for all keys and process them in the listenerEvent function
        redisListener.psubscribe('__keyevent*');
        redisListener.on('pmessage', listenerEvent);
    }

    // TODO: Is this redundant? Are event emitters a problem when refactoring? Implement event emitter handling
    /** @param {optionsObject} info **/
    function connectParentRedis(info) {
        parentRedisInfo = info;
        parentRedisBroadcaster = pack.connectToParent(info.host, info.port);
        parentRedisLogger = pack.connectToParent(info.host, info.port);
        parentStatusListeners.forEach(function (obj) {
            obj.func.call(obj.context, info, parentRedisBroadcaster);
        });

        parentRedisBroadcaster.on('error', function () {
            //parentConObj = null;
        });

        parentRedisLogger.on('error', function () {
            //parentConObj = null;
        });

        parentRedisBroadcaster.on('end', function () {
            //parentConObj = null;
        });

        parentRedisLogger.on('end', function () {
            //parentConObj = null;
        });
    }

    function disconnectParentRedis() {
        if (parentRedisBroadcaster !== undefined && parentRedisBroadcaster !== null) {
            parentRedisBroadcaster.quit();
        }
        if (parentRedisLogger !== undefined && parentRedisLogger !== null)
            parentRedisLogger.quit();
        parentRedisInfo = null;
    }

    // TODO: How does this work?
    function listenerEvent(pattern, channel, message) {
        let data = message.toString();

        if (data !== undefined) {
            if (jamdatastream_callbacks[data] !== undefined) {
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
                    let jamdatasource = jamdatasource_list[jamdatasource_key];
                    if (jamdatasource !== undefined) {
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

            //notify all listener_list for this message on the current key
            if (redisListener_list[data]) { //there are listener_list listening on this key

                let keyObject = buildKeyObject(data);

                for (let listener of redisListener_list[data]) {
                    if (listener.notify && typeof listener.notify === 'function')
                        listener.notify.call(listener, keyObject);
                    else if (typeof listener === 'function')
                        listener.call({}, keyObject);
                }
            }
        }
    }

    // Build subscription key for Apps that subscribe with Objects
    function buildKey(obj) {
        let key = 'aps[' + obj.app + ']';
        if (obj.namespace)
            key += '.ns[' + obj.namespace + ']';
        if (obj.flow)
            key += '.flow[' + obj.flow + ']';
        if (obj.datasource)
            key += '.ds[' + obj.datasource + ']';
        if (obj.datastream)
            key += '.dts[' + obj.datastream + ']';

        return key;
    }

    // Rebuild subscription key back to Objects
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


    // TODO: Would refactoring to a normal class based pose a problem
    init();

    pack = {
        app: cmdopts.app,
        redis: redisExecutor,
        host: host,
        port: port,

        isDevice: cmdopts.device,
        isFog: cmdopts.fog,
        isCloud: cmdopts.cloud,

        deviceID: jsys.id,
        fullID: jsys.id + "_" + jsys.type,

        add_jamdatasource: function (jamdatasource) {
            if (jamdatasource === undefined) {
                throw new Error("Undefined JAMDatasource");
            }
            jamdatasource_list[jamdatasource.key] = jamdatasource;
        },

        add_jamdatastream: function (jamdatastream) {
            if (jamdatastream === undefined) {
                throw new Error("Undefined JAMDatastream");
            }
            jamdatastream.redis = redisExecutor;
            jamdatastream_callbacks[jamdatastream.key] = jamdatastream;
        },

        delete_jamdatastream: function (key) {
            if (jamdatastream_callbacks[key])
                delete jamdatastream_callbacks[key];
        },

        log: function (key, value, slots, appID, deviceID) {
            let jamdatastream;
            // Check if we already have a key saved in the array
            if (jamdatastream_list[key]) {
                jamdatastream = jamdatastream_list[key].jamdatastream;
            } else {
                jamdatastream = new JAMDatastream(key, slots, redisExecutor);
                jamdatastream_list[key] = jamdatastream;
            }

            jamdatastream.log(value,
                /** @param {{status:boolean, error: String, message: String}} response **/
                function (response) {
                    // TODO: Callback is doing nothing? Why take an object when you can pass two things?
                });
        },

        // TODO: Why take in the redis?
        simpleLog: function (key, value, callback, redis, timestamp) {
            redis = redis ? redis : redisExecutor;

            // TODO: What's the point of this complicated else statement
            // Create new simple callback
            let cb = function (error, result) {
                if (error) {
                    if (callback) {
                        callback({
                            status: false,
                            error: error
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
            if (Boolean(key) && typeof key === 'object') {
                key = buildKey(key);
            }

            // Add listener to the appropriate list
            if (redisListener_list[key])
                redisListener_list[key].push(listener);
            else
                redisListener_list[key] = [listener];
        },

        unsubscribe: function (key, listener) {
            // Convert key to string if it is an object
            if (Boolean(key) && typeof key === 'object') {
                key = buildKey(key);
            }

            // Find the appropriate listener and remove it
            if (redisListener_list[key]) {
                let i = 0;
                for (let l of redisListener_list[key]) {
                    if (l == listener)
                        redisListener_list[key].splice(i, 1);
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
            return parentRedisBroadcaster;
        },

        getParentRedisLogger: function () {
            return parentRedisBroadcaster;
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

        // TODO: What does this take in?
        addParentUpSub: function (obj) {
            parentStatusListeners.push(obj);
        },

        getParentInfo: function () {
            return parentRedisInfo;
        },

        addBroadcaster: function (broadcaster) {
            broadcasters.push(broadcaster);
        },

        // Go through all the broadcasters and get the max clock
        getClock: function () {
            if (broadcasters.length === 0) {
                return null;
            }

            let max = {clock: broadcasters[0].clock, subClock: broadcasters[0].subClock};
            for (let broadcaster of broadcasters) {
                if (broadcaster.clock > max.clock || (broadcaster.clock == max.clock && broadcaster.subClock > max.subClock)) {
                    max.clock = broadcaster.clock;
                    max.subClock = broadcaster.subClock;
                }
            }
            return max.clock + '.' + max.subClock;
        }
    };

    return pack;
}

