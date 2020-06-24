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

        this.jammanager = jammanager;
        this.type = type;
        this.source = source;
        this.destination = destination;
        this.app = jammanager.app;

        this.transformer = (input) => input;

        var name = name || 'name0';
        var parts = name.split('.');
        if (parts.length === 2) {
            this.namespace = parts[0];
            this.name = parts[1];
        } else {
            this.namespace = 'global';
            this.name = name;
        }

        this.num_datastreams = 0;

        this.key = 'aps[' + this.app + '].ns[' + this.namespace + '].ds[' + this.name + ']';
        if (jammanager) {
            jammanager.add_jamdatasource(this);
        }

        this.listeners = [];
        //this.findAllStreams();    //this may be best if triggered by the programmer on a need basis
    }

    // Searches for all streams in Redis that matches this datasource key
    // and proactively add the streams which causes the streams to fetch their data
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
                self.addDatastream.call(self, obj.datastream);
            }
        });
    }

    _alreadyHasStream(key) {
        for (var i = 0; i < this.size(); i++) {
            if (this[i].key == key)
                return true;
        }
        return false;
    }

    // public API

    /* Returns the number of data streams in a data source (logger, filter, or transformation) */
    size() {
        return this.num_datastreams;
    }

    // internal implementation

    getApp() {
        return this.app;
    }

    getDeviceId() {
        return this.dev_id;
    }

    getNamespace() {
        return this.namespace;
    }

    getName() {
        return this.name;
    }

    getType()  {
        return this.type;
    }

    getDataType() {
        return this.dataType;
    }

    setDataType(dt) {
        this.dataType = dt;
    }


    // TODO change implementation to access num_datastreams in an atomic way
    addDatastream(dev_id) {
        var key = this.buildKey(dev_id);
        this[this.num_datastreams] = new JAMDatastream(dev_id, key, false, this.jammanager);
        this[this.num_datastreams].setDatasource(this);

        //subscribe all listeners to this datastream
        for (var i = 0; i < this.listeners.length; i++) {
            this[this.num_datastreams].subscribe(this.listeners[i]);
        }
        this[this.num_datastreams].setTransformer(this.transformer);

        this.num_datastreams++;
        return this[this.num_datastreams - 1];
    }


    setTransformer(func) {
        if (typeof func === 'function') {
            this.transformer = func;
            for (let i = 0; i < this.size(); i++)
                this[i].setTransformer(this.transformer);
        }
    }



    getMyDataStream() {
        var dev_id = this.jammanager.fullID;
        // Returns the existing jamdatastream
        for (var i = 0; i < this.size(); i++) {
            if (this[i].getDeviceId() === dev_id)
                return this[i];
        }

        // Else return a new jamdatastream
        var localStream = this.addDatastream(dev_id);
        localStream.isLocalStream = true;
        return localStream;
    }



    getDestination() {
        return this.destination;
    }

    buildKey(dev_id) {
        var key = 'aps[' + this.app + '].' +
            'ns[' + this.namespace + '].' +
            'ds[' + this.name + '].' +
            'dts[' + dev_id + ']';
        return key;
    }


    // TODO: Questionable implementation?
    subscribe(listener) {
        this.listeners.push(listener);
        for (var i = 0; i < this.size(); i++) {
            this[i].subscribe(listener);
        }
    }

    unsubscribe(listener) {
        for (let i = 0; i < this.listeners.length; i++) {
            if (this.listeners[i] == listener) {
                //unsubscribe from all datastreams for this datasource
                for (var j = 0; j < this.size(); j++) {
                    this[j].unsubscribe(listener);
                }

                this.listeners.splice(i, 1);
                break;
            }
        }
    }

    createIterator() {
        return (function (self) {
            var pos = 0;
            var length = self.size();

            return {
                [Symbol.iterator]: () => this,
                next() {
                    length = self.size();
                    return pos < length ? {value: self[pos++], done: false} : {done: true};
                }
            };
        })(this);
    }
}

module.exports = JAMDatasource;
