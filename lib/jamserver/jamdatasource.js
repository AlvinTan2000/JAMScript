const JAMDatastream = require('./jamdatastream');

class JAMDatasource {

    static jDataSourceList = {}

    /**
     * @param {JAMmanager} jammanager
     * @param {String} type - data source type (logger, filter, or transformation)
     * @param {String} name - data source name (optionally prefixed with namespace)
     * @param {String} source:- dev, fog, or cloud
     * @param {String} destination - dev, fog, or cloud
     */
    constructor(jammanager, type, name, source, destination) {

        // Attributes
        this.type = type;
        this.source = source;
        this.app = jammanager.app;
        this.destination = destination;

        // Associated Objects
        this.jammanager = jammanager;
        this.jamredis = jammanager.jamredis;

        // Data Related
        this.numDataStreams = 0;
        this.transformer = (input) => input;

        // Parse device name and namespace
        let currName = name || 'name0';
        let parts = currName.split('.');
        if (parts.length === 2) {
            this.namespace = parts[0];
            this.name = parts[1];
        } else {
            this.namespace = 'global';
            this.name = currName;
        }

        this.key = 'aps[' + this.app + '].ns[' + this.namespace + '].ds[' + this.name + ']';

        JAMDatasource.jDataSourceList[this.key] = this;
    }

    // TODO: To fix
    // Searches for all streams in Redis that matches this datasource key
    findAllStreams() {
        let pattern = 'aps\\[' + this.app + '\\].' +
            'ns\\[' + this.namespace + '\\].' +
            'ds\\[' + this.name + '\\].' +
            'dts\\[*\\]';
        let redis = this.jammanager.redis;
        var self = this;
        redis.keys(pattern, function (err, response) {
            if (err)
                console.log(err);
            for (let key of response) {
                if (self._alreadyHasStream.call(self, key))
                    continue;
                var obj = self.jammanager.buildKeyObject(key);
                self.addDataStream.call(self, obj.datastream);
            }
        });
    }

    _alreadyHasStream(key) {
        for (let i = 0; i < this.size(); i++) {
            if (this[i].key == key)
                return true;
        }
        return false;
    }


    size() {
        return this.numDataStreams;
    }

    getName() {
        return this.name;
    }

    getNamespace() {
        return this.namespace;
    }

    getDataType() {
        return this.dataType;
    }

    setDataType(dataType) {
        this.dataType = dataType;
    }

    setTransformer(func) {
        if (typeof func === 'function') {
            this.transformer = func;
            // Update the transformers for all JAMDatastreams
            for (let i = 0; i < this.size(); i++)
                this[i].setTransformer(this.transformer);
        }
    }


    addDataStream(deviceID) {
        let key = this.buildKey(deviceID);
        this[this.numDataStreams] = new JAMDatastream(deviceID, key, this.jammanager, this);
        this[this.numDataStreams].setTransformer(this.transformer);
        this.numDataStreams++;
        return this[this.numDataStreams - 1];
    }

    getMyDataStream() {
        let dev_id = this.jammanager.fullID;

        // Returns the existing jamdatastream
        for (var i = 0; i < this.size(); i++) {
            if (this[i].getDeviceId() === dev_id) {
                return this[i];
            }
        }

        // Else return a new jamdatastream
        let localStream = this.addDataStream(dev_id);
        localStream.isLocalStream = true;
        return localStream;
    }

    buildKey(deviceID) {
        return 'aps[' + this.app + '].' +
            'ns[' + this.namespace + '].' +
            'ds[' + this.name + '].' +
            'dts[' + deviceID + ']';
    }


    static listenerEvent(pattern, channel, bufferData) {
        let data = bufferData.toString();
        if (data !== undefined) {
            // If the associated JAMDataStream exist, query the new data
            if (JAMDatastream.jDataStreamList[data] != undefined) {
                JAMDatastream.jDataStreamList[data].queryNewData();
            }
            // Else create a new JAMDatastream and query the new data
            else {
                let idx = data.lastIndexOf('.');
                if (idx !== -1) {
                    let jDataSourceKey = data.substring(0, idx);
                    let jamdatasource = JAMDatasource.jDataSourceList[jDataSourceKey];  // Get the appropriate JAMDataSource
                    if (jamdatasource != undefined) {
                        let deviceId = data.substring(data.lastIndexOf('[') + 1, data.length - 1);
                        jamdatasource.addDataStream(deviceId).queryNewData();
                    }
                }
            }
        }
    }
}

module.exports = JAMDatasource;
