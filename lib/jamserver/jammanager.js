var Redis = require('redis');
var JAMBroadcaster = require('./jambroadcaster');
var JAMRedis = require('./jamredis');
var ebus = require('./ebus');


module.exports = function (cmdopts, jsys) {
    var host = cmdopts.redhost;
    var port = cmdopts.redport;
    var jamredis = new JAMRedis(host, port);
    var pack = {};  //the object to return

    // this is the handle that would be passed to all instances of the JAMDatastream for making a call to the Redis server
    var executor = Redis.createClient({
        host: host,
        port: port,
        "return_buffers": true
    });


    var parentConObj = null;    //the data retrieved from listening to the parent advertisement on their IP address

    ebus.on('fog-data-up', function (info) {
        console.log("Fog Data Up -------------------------", info, parentConObj);
        if (pack.isDevice && (parentConObj === null || parentConObj.host != info.host || parentConObj.port != info.port))
            doConnectToParent(info);
    });

    ebus.on('fog-data-down', function () {

        if (pack.isDevice && (parentConObj !== null))
            doDisconnectFromParent();
    });

    ebus.on('cloud-data-up', function (info) {
        console.log("Cloud Data Up ------------------------XXXXX", info);
        if (pack.isFog && (parentConObj === null || parentConObj.host != info.host || parentConObj.port != info.port))
            doConnectToParent(info);
    });

    ebus.on('cloud-data-down', function () {

        if (pack.isFog && (parentConObj !== ull))
            doDisconnectFromParent();
    });

    function doConnectToParent(info) {
        parentConObj = info;
        jamredis.parentUp(info.host, info.port);
        JAMBroadcaster.parentUpSub(info);
    }


    pack = {
        host: host,
        port: port,
        deviceID: jsys.id,
        fullID: jsys.id + "_" + jsys.type,

        jamredis: jamredis,
        app: cmdopts.app,
        redis: executor,

        isDevice: cmdopts.device,
        isFog: cmdopts.fog,
        isCloud: cmdopts.cloud,
        getLevelCode: function () {
            if (pack.isDevice)
                return "device";
            return pack.isFog ? "fog" : "cloud";
        },


    };

    return pack;
}