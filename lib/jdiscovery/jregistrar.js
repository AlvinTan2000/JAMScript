var EventEmitter = require('events'),
    globals = require('../jamserver/constants').globals,
    constants = require('../jamserver/constants'),
    MQTTRegistry = require('./mqttregistry'),
    MDNSRegistry = require('./mdnsregistry'),
    os = require('os');

//==============================================================================
// Registrar Class
// This class is the interface between the application
// and the MQTT, mDNS registries
//==============================================================================

function Registrar(app, machType, id, port, config) {
    // the name of the application
    this.app = app;
    // the type of the machine the registar is running on (device, fog, or cloud)
    this.machType = machType;
    // the id of the machine
    this.id = id;
    // the port the program is running on
    if (typeof port === 'string') {
        port = parseInt(port);
    }
    if (!(typeof port === 'number')) {
        throw new Error('port is not a number');
    }
    this.port = port;

    /**
     * DISCOVERY TABLE (dt)
     * Notes:
     *  --> We don't keep an entry for our own node
     *
     * And an example...
     * {
     *      node_id : {
     *          'attrs' : {
     *              'status' : {
     *                  'seqval' : seqval,
     *                  'data' : data
     *              },
     *              other_attr : {
     *                  'seqval' : seqval,
     *                  'data' : data
     *              }
     *          }
     *          'network' : 'LAN' || 'WAN',
     *          'other_useful_info' : ...
     *      },
     *      other_node_id : {
     *          ...
     *      }
     * }
     */
    this.seqval = 0;
    this.dt = {};

    /**
     * Reserved attributes.
     * These are attribute names that cannot be used by third parties.
     */
    this.reservedAttrs = ['status', 'lastCheckIn', 'createdAt', 'updatedAt'];

    // whether or not this registrar has been started
    this.started = false;

    /**
     * config-specific set-up
     */
    var noProtocols = true;

    if (!config || !config.protocols || config.protocols.mqtt) {
        // QoS |1| for MQTT: Message delivery is __AT_LEAST_ONCE__
        var subQos = 1,
            pubQos = 1;
        this.mqttRegistry = new MQTTRegistry(app, machType, id, port, subQos, pubQos);
        noProtocols = false;
    }
    if (!config || !config.protocols || config.protocols.mdns) {
        this.mdnsRegistry = new MDNSRegistry(app, machType, id, port);
        noProtocols = false;
    }
    if (noProtocols) {
        throw new Error('a Registrar must use at least one protocol');
    }

    /**
     * Set up default attributes, which are the same for devices, fogs, and clouds.
     * The only default attribute is 'status'.
     */
    this.addAttributes({
        status: function() {
            return {
                port: port,
                ip: this._getIPv4Address()
            };
        }
    }, true);

    /**
     * Prep the default discoveries to be made by a node:
     * devices discover fogs and fogs discover clouds.
     */
    if (this.machType === globals.NodeType.DEVICE) {
        // default discoveries:
        // devices discover fogs
        this.discoverAttributes({
            fog: {
                status: {
                    online: 'fog-up',
                    offline: 'fog-down'
                    // if the status value is `offline`, then we emit fog-down, else we emit fog-up
                }
            },
            cloud: {
                status: {
                    online: 'cloud-up',
                    offline: 'cloud-down'
                }
            }
        });
    } else if (this.machType === globals.NodeType.FOG) {
        // default discoveries:
        // fogs discover clouds
        this.discoverAttributes({
            cloud: {
                status: {
                    online: 'cloud-up',
                    offline: 'cloud-down'
                }
            }
        });
    } else {
        // If this node is a cloud, then it discovers nothing by default!
    }

    // listen for events from the Registries
    var self = this;

    if (this.mqttRegistry) {
        /**
         * MQTT SPECIFIC ERRORS
         */ 
        this.mqttRegistry.on('sub-error', function(attrs) {
            setTimeout(self.mqttRegistry.subscribe, constants.mqtt.longRetryInterval, self.mqttRegistry, attrs);
        });

        this.mqttRegistry.on('subs-denied', function(attrs) {
            var err = new Error('MQTT subscriptions denied');
            err.name = 'permissions_err';
            err.value = attrs;
            self.emit('error', err);
        });

        this.mqttRegistry.on('unsub-error', function(attrs) {
            setTimeout(self.mqttRegistry.unsubscribe, constants.mqtt.longRetryInterval, self.mqttRegistry, attrs);
        });

        this.mqttRegistry.on('pub-error', function(attr, value) {
            setTimeout(self.mqttRegistry.publish, constants.mqtt.longRetryInterval, self.mqttRegistry, attr, value);
        });

        this.mqttRegistry.on('unpub-error', function(attr) {
            setTimeout(self.mqttRegistry.unpublish, constants.mqtt.longRetryInterval, self.mqttRegistry, attr);
        });

        /**
         * MQTT PROPAGATABLE EVENTS
         */ 
        this.mqttRegistry.on('discovery', function(attr, event, nodeId, value, dedupeId) {
            self._respondToDiscoveryEvent.call(self, attr, event, nodeId, value, dedupeId, constants.globals.Protocol.MQTT);
        });

        this.mqttRegistry.on('attr-removed', function(attr, event, nodeId) {
            self._respondToAttrRemovalEvent.call(self, attr, event, nodeId, constants.globals.Protocol.MQTT);
        });
    }

    if (this.mdnsRegistry) {
        /**
         * mDNS SPECIFIC ERRORS
         */ 
        this.mdnsRegistry.on('ad-error', function(attr, adName, txtRecord) {
            // an ad failed - try again after some time
            setTimeout(self.mdnsRegistry._createAdvertisementWithRetries, constants.mdns.longRetryInterval,
                        self.mdnsRegistry, attr, adName, txtRecord, 0);
        });

        this.mdnsRegistry.on('browser-error', function(attr, machType, events) {
            // a browser failed - try again after some time
            if (attr === 'status') {
                setTimeout(self.mdnsRegistry._browseForStatus, constants.mdns.longRetryInterval, self.mdnsRegistry, machType, events);
            } else {
                setTimeout(self.mdnsRegistry._browse, constants.mdns.longRetryInterval, self.mdnsRegistry, attr, machType, events);
            }
        });

        /**
         * mDNS PROPAGATABLE EVENTS
         */ 
        this.mdnsRegistry.on('discovery', function(attr, event, nodeId, value, dedupeId) {
            self._respondToDiscoveryEvent.call(self, attr, event, nodeId, value, dedupeId, constants.globals.Protocol.MDNS);
        });

        this.mdnsRegistry.on('attr-removed', function(attr, event, nodeId) {
            self._respondToAttrRemovalEvent.call(self, attr, event, nodeId, constants.globals.Protocol.MDNS);
        });
    }
}

/* Registrar inherits from EventEmitter */
Registrar.prototype = Object.create(EventEmitter.prototype);
Registrar.prototype.constructor = Registrar;

//==============================================================================
// API
//==============================================================================

/**
 * Register a node on the network, and discover other nodes.
 * `options` is an optional parameter
 * `options` include:
 *   attrsToAdd: key/value pair as in this.addAttributes
 *   attrsToDiscover: as in this.discoverAttributes
 */
Registrar.prototype.registerAndDiscover = function(options) {
    if (this.started)
        return;

    if (options) {
        if (typeof options !== 'object') {
            throw new Error('options must be an object - see the docs');
        }

        if (options.attrsToAdd) {
            this.addAttributes(options.attrsToAdd);
        }
        if (options.attrsToDiscover) {
            this.discoverAttributes(options.attrsToDiscover);
        }
    }

    if (this.mqttRegistry) {
        this.mqttRegistry.registerAndDiscover();
    }
    if (this.mdnsRegistry) {
        this.mdnsRegistry.registerAndDiscover();
    }

    this.started = true;
}

/**
 * Add custom, discoverable attributes to this node
 * attrs is an object of key value pairs
 */
Registrar.prototype.addAttributes = function(attrs) {
    this._modifyAttributes("addAttributes", attrs, this._getSeqVal());
}

Registrar.prototype.removeAttributes = function(attrs) {
    this._modifyAttributes("removeAttributes", attrs, this._getSeqVal());
}

/**
 * Specify attributes to be discovered.
 * dattrs can have one of the following forms:
 * (a)
 *    {
 *        all: {attr: event}, // discover these attributes for all nodes
 *        device: {attr: event}, // discover these attributes just for devices
 *        fog: {attr: event}, // discover these attributes just for fogs
 *        cloud: {attr: event} // discover these attributes just for clouds
 *    }
 * (b) As a shortcut for all, one can simply pass an object of <attr, event> pairs
 */
Registrar.prototype.discoverAttributes = function(attrs) {
    this._modifyAttributes("discoverAttributes", attrs, this._getSeqVal());
}

Registrar.prototype.stopDiscoveringAttributes = function(attrs) {
    this._modifyAttributes("stopDiscoveringAttributes", attrs, this._getSeqVal());
}

Registrar.prototype._modifyAttributes = function(fun, attrs, seqval) {
    if (this.mqttRegistry) {
        this.mqttRegistry[fun](attrs, seqno);
    }
    if (this.mdnsRegistry) {
        this.mdnsRegistry.[fun](attrs, seqno);
    }
}

//==============================================================================
// Helpers
//==============================================================================

/**
 * Upon receipt of a discovery event, pass it onto the rest of the application if it is not a duplicate
 */
Registrar.prototype._respondToDiscoveryEvent = function(attr, event, id, data, seqval, protocol) {

    console.log("---------------------------------- ", event, id, data);

    if (!this.dt.hasOwnProperty(attr)) {
        this.dt[attr] = {};
    }
    this.dt[attr][id] = seqval;

    // Because node offline events end up here instead of in _respondToAttrRemovalEvent, we need to check the attribute
    // and value in order to know what arguments to pass along with the event.
    if (attr === 'status' && data === 'offline') {
        this.emit(event, id, protocol);
        return;
    }
    this.emit(event, id, data, protocol);
}

/**
 * Upon receipt of an attribute removal event, pass it onto the rest of the application
 */
Registrar.prototype._respondToAttrRemovalEvent = function(attr, event, id, protocol) {
    if ((!this.dt.hasOwnProperty(attr) || !this.dt[attr].hasOwnProperty(nodeId))) {
        return;
    }
    delete this.dt[attr][nodeId];
    this.emit(event, id, protocol);
}

/**
 * returns next seq number for event ordering
 */
Registar.prototype._getSeqVal = function() {
    return this.seqval++;
}

/**
 * returns the IPv4 address of the node
 */
Registar.prototype._getIPv4Address = function() {
    var niaddrs = os.networkInterfaces();
    for (var ni in niaddrs) {
        nielm = niaddrs[ni];
        for (n in nielm) {
            if (nielm[n].family === 'IPv4' && nielm[n].internal === false)
                return nielm[n].address
        }
    }
    return globals.localhost;
}

/* exports */
module.exports = Registrar;
