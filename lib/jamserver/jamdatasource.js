'use strict';

const JAMDatastream = require('./jamdatastream');

class JAMDatasource {

    /**
     * @param {JAMmanager} jammanager
     * @param {String} type - data source type (logger, filter, or transformation)
     * @param {String} name - data source name (optionally prefixed with namespace)
     * @param {String} source:- dev, fog, or cloud
     * @param {String} destination - dev, fog, or cloud
     */
    constructor(jammanager, type, name, source, destination) {
        console.log("Created JAMMdatasource");

        this.jammanager = jammanager;
        this.type = type;
        this.source = source;
        this.destination = destination;
        this.app = jammanager.app;

        this.listeners = [];
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

        // Register JAMDatasource with JAMManager
        this.key = 'aps[' + this.app + '].ns[' + this.namespace + '].ds[' + this.name + ']';
        if (jammanager) {
            jammanager.add_jamdatasource(this);
        }
    }

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

    getNamespace() {
        return this.namespace;
    }

    getName() {
        return this.name;
    }

    getType() {
        return this.type;
    }

    getDestination() {
        return this.destination;
    }

    getDataType() {
        return this.dataType;
    }

    setDataType(dt) {
        this.dataType = dt;
    }

    setTransformer(func) {
        if (typeof func === 'function') {
            this.transformer = func;
            // Update the transformers for all JAMDatastreams
            for (let i = 0; i < this.size(); i++)
                this[i].setTransformer(this.transformer);
        }
    }

    addDatastream(dev_id) {//TODO change implementation to access num_datastreams in an atomic way
        console.log("JAMDatasource addDataStream()");

        // Build key with device ID and create new JAMDatastream
        let key = this.buildKey(dev_id);
        this[this.num_datastreams] = new JAMDatastream(dev_id, key, false, this.jammanager);
        this[this.num_datastreams].setDatasource(this);

        // Subscribe all listeners to this datastream
        for(let i = 0; i < this.listeners.length; i++){
            this[this.num_datastreams].subscribe(this.listeners[i]);
        }
        this[this.num_datastreams].setTransformer(this.transformer);

        this.num_datastreams++;
        return this[this.num_datastreams-1];
    }

    getMyDataStream() {
        console.log("JAMMdatasource getMyDataStream()");
        let dev_id = this.jammanager.fullID;

        // Returns the existing jamdatastream
        for (var i = 0; i < this.size(); i++) {
            if (this[i].getDeviceId() === dev_id)
                return this[i];
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

    subscribe(listener){
        console.log("JAMMdatasource subscribe");

        this.listeners.push(listener);
        for (let i = 0; i < this.size(); i++) {
            this[i].subscribe(listener);
        }
    }

    unsubscribe(listener){
        console.log("JAMMdatasource unsubscribe");
        for( let i = 0; i < this.listeners.length; i++ ){
            if( this.listeners[i] == listener ){
                // Unsubscribe from all JAMDatastreams for this JAMDatasource
                for(var j = 0; j < this.size(); j++){
                    this[j].unsubscribe(listener);
                }
                this.listeners.splice(i, 1);
                break;
            }
        }
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
}

module.exports = JAMDatasource;
