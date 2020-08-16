const ebus = require('./ebus');
const JAMRedis = require('./jamredis');

class JAMManager {
    constructor(cmdOpts, jSys) {
        // Application information
        this.app = cmdOpts.app;
        this.host = cmdOpts.redhost;
        this.port = cmdOpts.redport;
        this.jamredis = new JAMRedis(this.host, this.port);

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


        ebus.on('cloud-data-up', function (info) {
            console.log("Cloud Data Up ------------------------XXXXX", info);
            if (cmdOpts.fog)
                self.connectParent(info);
        });

    }

    getLevelCode() {
        return this.level;
    }

    connectParent(info) {
        this.jamredis.parentUp(info.host, info.port);
    }
}

module.exports = JAMManager;