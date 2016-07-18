/**
 * Created by richboy on 15/06/16.
 *
 * This file listens for events in the key space and takes the required action. It also
 */

var Redis = require('redis-fast-driver');
//var JBroadcaster = require('./jbroadcaster.js');
var JLogger = require('./jlogger.js');

var jlogger_callbacks = [];

module.exports = (function(host, port){
    /**
     * Each element in the jamdata is a pair of key => logger.
     * Sample: key: logger: ...
     * key is the unique key which would receive the storage elements or act as the subscription handle/tag
     * object is a JLogger object
     * @type {Object}
     */
    var loggers = {};
    var msg_receive_callback = undefined;
    //this is the redis instance that would be sent to all broadcast domains...
    //and would be used to broadcast messages to all subscribed
    var broadcaster = new Redis({
        host: host,
        port: port
    });

    //this would listen for all keyspace events (using the keyevent notification mechanism) and channel it to the right logger
    var listener = new Redis({
        host: host,
        port: port
    });

    //this is the handle that would be passed to all instances of the JLogger for making a call to the Redis server
    var executor = new Redis({
        host: host,
        port: port
    });

    //TODO check if the redis connection was successful before attempting to query the redis server

    //'__keyevent@*:*'
    function init(){
        //listen for all events for all keys and process them in the listenerEvent function
        listener.rawCall(['psubscribe', '__keyevent*'], listenerEvent);
    }

    function handle_task_result(key, data, process_response){
      console.log("Handling Results.... \n", data);
      var result_logger = new JLogger(key);
      result_logger.zrange(key, -1, -1, process_response);
    }

    function listenerEvent(e, data){
        var logger;

        if( e )
            console.log('RECEIVE-ERROR', e);
        else{
            console.log('RECEIVED', data, ' from keyword ', data[3]);
            if(jlogger_callbacks[data[3]] != undefined){
              //msg_receive_callback(data);
              console.log("PLEASE");
              handle_task_result(data[3], data, jlogger_callbacks[data[3]]);
            }else{
              console.log("Callback Missing ... ");
            }
        }
        //channel event to the correct key
        if( data[0] == "pmessage" ){//check if this event corresponds to a message event
            //get the key and event-action that occurred
            var eventKey = data[data.length - 1];
            var eventAction = data[data.length - 2].split("__:")[1];

            //check if the key exists in the loggers
            if( (logger = loggers[eventKey]) );
            else {
                //TODO because this key wasn't reported to JManager/JNode, the number of slots is current not bounded.
                //We probably need to implement a scheme that will enable the JNode to retrieve the bound/number of entries
                logger = new JLogger(eventKey, -1, executor);
                loggers[eventKey] = logger;
            }

            logger.processEvent(eventAction);
        }
    }

    init();


    return {
        broadcastMessage: function(domain, message){
            //"JBROADCAST:" + domain
            broadcaster.rawCall(['PUBLISH', domain, message]);
        },
        set_msg_rcv_callback: function(callback){
          msg_receive_callback = callback;
        },
        jlogger_add_callback: function(keyword, callback){
          jlogger_callbacks[keyword] = callback;
        },
        jlogger_remove_callback: function(keyword){
          jlogger_callbacks[keyword] = undefined;
        },
        log: function(key, value, slots, appID, deviceID){
            //check if we already have a key saved in the array
            //TODO we may have to qualify the key later with the Application ID and maybe device ID as well

            var logger;

            if( loggers[key] )//we have added this key before
                logger = loggers[key].logger;
            else{//a new key
                logger = new JLogger(key, slots, executor);
                loggers[key] = logger;
            }

            logger.log(value, function(resp){
                //resp is an object with 'status' and based on the status state, we could have error (if process failed),
                //or message (if process was successful)
            });
        }
    };
})('127.0.0.1', 6379);
