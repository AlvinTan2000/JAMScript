const ebus = require('./ebus');
const JAMRedis = require('./jamredis');
const JAMBroadcaster = require('./jambroadcaster');
const JAMDatasource = require ('./jamdatasource')

class JAMManager {
    constructor(cmdOpts, jSys) {
        // Application information
        this.app = cmdOpts.app;
        this.host = cmdOpts.redhost;
        this.port = cmdOpts.redport;
        this.jamredis = new JAMRedis(this.host, this.port, JAMDatasource.listenerEvent);

        // Node information
        this.deviceID = jSys.id;
        this.fullID = jSys.id + "_" + jSys.type;

        this.level = '';
        if (cmdOpts.device)
            this.level = "device";
        else if (cmdOpts.fog) {
            this.level = "fog"
        } else if (cmdOpts.cloud) {
            this.level = "cloud"
        }

        // Event Bus listening for connecting and disconnecting
        let self = this;
        ebus.on('fog-data-up', function (info) {
            console.log("Fog Data Up -------------------------", info);
            if (cmdOpts.device)
                self.connectParent(info);
        });

        ebus.on('fog-data-down', function () {
            if (cmdOpts.device)
                self.disconnectParent();
        });

        ebus.on('cloud-data-up', function (info) {
            console.log("Cloud Data Up ------------------------XXXXX", info);
            if (cmdOpts.fog)
                self.connectParent(info);
        });

        ebus.on('cloud-data-down', function () {
            if (cmdOpts.fog)
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