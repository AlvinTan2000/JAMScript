const ebus = require('./ebus');
const JAMRedis = require('./jamredis');
const JAMBroadcaster = require('./jambroadcaster');

class JAMManager {
    constructor(cmdopts, jsys) {
        // Application information
        this.app = cmdopts.app;
        this.host = cmdopts.redhost;
        this.port = cmdopts.redport;
        this.jamredis = new JAMRedis(this.host, this.port);

        // Node information
        this.deviceID = jsys.id;
        this.fullID = jsys.id + "_" + jsys.type;

        this.level = '';
        if (cmdopts.device)
            this.level = "device";
        else if (cmdopts.fog) {
            this.level = "fog"
        } else if (cmdopts.cloud) {
            this.level = "cloud"
        }

        // Event Bus listening for connecting and disconnecting
        let self = this;
        ebus.on('fog-data-up', function (info) {
            console.log("Fog Data Up -------------------------", info);
            if (cmdopts.device)
                self.connectParent(info);
        });

        ebus.on('fog-data-down', function () {
            if (cmdopts.device)
                self.disconnectParent();
        });

        ebus.on('cloud-data-up', function (info) {
            console.log("Cloud Data Up ------------------------XXXXX", info);
            if (cmdopts.fog)
                self.connectParent(info);
        });

        ebus.on('cloud-data-down', function () {
            if (cmdopts.fog)
                self.disconnectParent();
        });
    }

    getLevelCode() {
        return this.level;
    }

    connectParent(info) {
        this.jamredis.parentUp(info.host, info.port);
        JAMBroadcaster.parentUpSub(info);
    }

    disconnectParent() {
        this.jamredis.parentDown();
    }
}

module.exports = JAMManager;