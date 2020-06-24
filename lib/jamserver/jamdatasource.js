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
        this.app = jammanager.app;
        this.type = type;
        this.source = source;
        this.destination = destination;

        this.listeners = [];                    // TODO: What does this store
        this.num_datastreams = 0;

        this.transformer = (input) => input;
        this.key = 'aps[' + this.app + '].ns[' + this.namespace + '].ds[' + this.name + ']';

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
        if (jammanager) {
            jammanager.add_jamdatasource(this);
        }
    }

    // Searches for all streams in Redis that matches this datasource key
    // and proactively add the streams which causes the streams to fetch their data
    findAllStreams() {
        let pattern = 'aps\\[' + this.app + '\\].' +
            'ns\\[' + this.namespace + '\\].' +
            'ds\\[' + this.name + '\\].' +
            'dts\\[*\\]';
        let redis = this.jammanager.redis;
        let self = this;
        redis.keys(pattern, function (err, response) {
            if (err)
                console.log(err);
            for (let key of response) {
                if (self._alreadyHasStream.call(self, key))
                    continue;
                let obj = self.jammanager.buildKeyObject(key);
                self.addDatastream.call(self, obj.datastream);
            }
        });
    }

    _alreadyHasStream(key) {
        for (let i = 0; i < this.size(); i++) {
            if (this[i].key === key)
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



    addDatastream(deviceID) {
        // TODO: Improper constructor calling

        // Build key with device ID and create new JAMDatastream
        let key = this._buildKey(deviceID);
        this[this.num_datastreams] = new JAMDatastream(deviceID, key, false, this.jammanager);
        this[this.num_datastreams].setDatasource(this);

        // Copy all listeners and the transformers
        for (let i = 0; i < this.listeners.length; i++) {
            this[this.num_datastreams].subscribe(this.listeners[i]);
        }
        this[this.num_datastreams].setTransformer(this.transformer);

        this.num_datastreams++;
        return this[this.num_datastreams - 1];
    }

    // TODO: What is "my" datastream
    getMyDataStream() {
        let deviceID = this.jammanager.fullID;

        // Returns the existing jamdatastream
        for (let i = 0; i < this.size(); i++) {
            if (this[i].getDeviceId() === deviceID)
                return this[i];
        }

        // Else return a new jamdatastream
        let localStream = this.addDatastream(deviceID);
        localStream.isLocalStream = true;
        return localStream;
    }

    _buildKey(deviceID) {
        return 'aps[' + this.app + '].' +
            'ns[' + this.namespace + '].' +
            'ds[' + this.name + '].' +
            'dts[' + deviceID + ']';
    }



    // TODO: Difference between datasource and datastream listeners
    subscribe(listener) {
        this.listeners.push(listener);
        for (let i = 0; i < this.size(); i++) {
            this[i].subscribe(listener);
        }
    }

    unsubscribe(listener) {
        for (let i = 0; i < this.listeners.length; i++) {
            if (this.listeners[i] === listener) {
                // Unsubscribe from all JAMDatastreams for this JAMDatasource
                for (let j = 0; j < this.size(); j++) {
                    this[j].unsubscribe(listener);
                }
                this.listeners.splice(i, 1);
                break;
            }
        }
    }



    createIterator() {
        return (function (self) {
            let pos = 0;
            let length = self.size();

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
