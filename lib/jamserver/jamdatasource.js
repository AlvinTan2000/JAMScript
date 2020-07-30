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

        this.jammanager = jammanager;
        this.jamredis = jammanager.jamredis;
        this.type = type;
        this.source = source;
        this.destination = destination;
        this.app = jammanager.app;

        this.num_datastreams = 0;
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

        // Register JAMDatasource with JAMManager
        JAMDatasource.jDataSourceList[this.key] = this;

    }

    // TODO: To fix
    // Searches for all streams in Redis that matches this datasource key
    // and proactively add the streams which causes the streams to fetch their data
    findAllStreams(){
        let pattern = 'aps\\[' + this.app + '\\].' +
            'ns\\[' + this.namespace + '\\].' +
            'ds\\[' + this.name + '\\].' +
            'dts\\[*\\]';
        let redis = this.jammanager.redis;
        var self = this;
        redis.keys(pattern, function(err, response){
            if( err )
                console.log(err);
            for( let key of response ){
                if( self._alreadyHasStream.call(self, key) )
                    continue;
                var obj = self.jammanager.buildKeyObject(key);
                self.addDatastream.call(self, obj.datastream);
            }
        });
    }

    _alreadyHasStream(key){
        for( var i = 0; i < this.size(); i++ ){
            if( this[i].key == key )
                return true;
        }
        return false;
    }

    /* Returns the number of data streams in a data source*/
    size() {
        return this.num_datastreams;
    }

    getApp() {
        return this.app;
    }
    getType() {
        return this.type;
    }
    getName() {
        return this.name;
    }
    getNamespace() {
        return this.namespace;
    }
    getDestination() {
        return this.destination;
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

    // TODO change implementation to access num_datastreams in an atomic way
    addDatastream(deviceID) {
        // Build key with device ID and create new JAMDatastream
        let key = this.buildKey(deviceID);
        this[this.num_datastreams] = new JAMDatastream(deviceID, key, this.jammanager, this);
        this[this.num_datastreams].setTransformer(this.transformer);

        this.num_datastreams++;
        return this[this.num_datastreams-1];
    }

    // TODO: Try and remove
    getMyDataStream() {
        let dev_id = this.jammanager.fullID;

        // Returns the existing jamdatastream
        for (var i = 0; i < this.size(); i++) {
            if (this[i].getDeviceId() === dev_id) {
                return this[i];
            }
        }

        // Else return a new jamdatastream
        let localStream = this.addDatastream(dev_id);
        localStream.isLocalStream = true;
        return localStream;
    }

    buildKey(dev_id) {
        return 'aps[' + this.app + '].' +
            'ns[' + this.namespace + '].' +
            'ds[' + this.name + '].' +
            'dts[' + dev_id + ']';
    }

    toIterator(){
        return (function(self){
            var pos = 0;
            var length = self.size();

            return {
                [Symbol.iterator]: () => this,
                next(){
                    length = self.size();
                    return pos < length ? {value: self[pos++], done: false} : {done: true};
                }
            };
        })(this);
    }

    static listenerEvent(pattern, channel, bufferData) {
        let data = bufferData.toString();
        if (data !== undefined) {
            if (JAMDatastream.jDataStreamList[data] != undefined) {
                let jamdatastream = JAMDatastream.jDataStreamList[data];
                jamdatastream.set_size++;
                jamdatastream.queryNewData();
            } else {
                let idx = data.lastIndexOf('.');
                if (idx !== -1) {
                    let jamdatasource_key = data.substring(0, idx);
                    let jamdatasource = JAMDatasource.jDataSourceList[jamdatasource_key];
                    if (jamdatasource != undefined) {
                        idx = data.lastIndexOf('[');
                        var deviceId = data.substring(idx + 1, data.length - 1);
                        jamdatasource.addDatastream(deviceId);
                        let jamdatastream = JAMDatastream.jDataStreamList[data];
                        jamdatastream.set_size++;
                        jamdatastream.queryNewData();
                    }
                }
            }
        }
    }
}

module.exports = JAMDatasource;
