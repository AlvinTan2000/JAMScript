var mdns = require('./mdns/lib/mdns'),
    constants = require('../jamserver/constants'),
    Registry = require('./registry');

var sequence = [
    mdns.rst.DNSServiceResolve(),
    'DNSServiceGetAddrInfo' in mdns.dns_sd ?
	mdns.rst.DNSServiceGetAddrInfo() : mdns.rst.getaddrinfo({families:[0]}),
    mdns.rst.makeAddressesUnique()
];

function MDNSRegistry(app, type, id, port) {

    Registry.call(this, app, type, id, port);
    this.protocol = constants.globals.Protocol.MDNS;

    this.ads = {};
    this.attrsToAdvertise = {};

    this.browsers = {
        device: {},
        fog: {},
        cloud: {}
    };
    this.attrsToBrowse = {
        device: {},
        fog: {},
        cloud: {}
    }

    this.started = false;
}

/* MDNSRegistry inherits from Registry */
MDNSRegistry.prototype = Object.create(Registry.prototype);
MDNSRegistry.prototype.constructor = MDNSRegistry;


/**
 * REGISTRY INTERFACE METHODS
 */

/**
 * Start mDNS registry
 */
MDNSRegistry.prototype.registerAndDiscover = function() {

    if(this.started)
        return;
    this.started = true;
}
/**
 * Sets attributes by starting ads or modifying them.
 * attrs - an object of attributes
 * seqval - the ID to publish with the attributes for deduplication purposes
 *          on the receiving node
 */
MDNSRegistry.prototype.setAttributes = function(attrs, seqval) {
    console.log('mDNS-reg: called setAttributes');
    if (this.started) {
        this._createAdvertisements(attrs, seqval);
    } else {
        let self = this;
        setTimeout(self.setAttributes.bind(self), 
            constants.mdns.retryInterval,
            attrs, seqval);
    }
}
/**
 * Removes attributes by stopping the advertisements
 */
MDNSRegistry.prototype.removeAttributes = function(attrs, seqval) {
    for (var attr in attrs) {
        if (attrs.hasOwnProperty(attr)) {
            if (this.attrsToAdvertise[attr] && this.ads[attr]) {
                this.ads[attr].stop();
                delete this.attrsToAdvertise[attr];
                delete this.ads[attr];
            }
        }
    }
}
/**
 * Discovers attributes by starting browsers
 */
MDNSRegistry.prototype.discoverAttributes = function(dattrs) {
    if (this.started) {
        ['device', 'fog', 'cloud'].map(
            (x) => {
                for (var attr in dattrs[x]) {
                    if(dattrs[x].hasOwnProperty(attr)) {
                        if (!this.browsers[x][attr]) {
                            this._createBrowser(attr, 
                                constants.globals.NodeType.DEVICE, 
                                dattrs[x][attr]);
                        }
                    }
                }
            }
        );
    } else {
        let self = this;
        setTimeout(self.discoverAttributes.bind(self), 
            constants.mdns.retryInterval,
            dattrs);
    }
}
/**
 * Stops making discoveries by stopping browsers
 */
MDNSRegistry.prototype.stopDiscoveringAttributes = function(dattrs) {
    ['device', 'fog', 'cloud'].map(
        x => {
            if (dattrs[x]) {
                for(var attr in dattrs[x]) {
                    if (dattrs[x].hasOwnProperty(attr)) {
                        if (this.attrsToBrowse[x][attr] && this.browsers[x][attr]) {
                            this.browsers[x][attr].stop();
                            delete this.attrsToBrowse[x][attr];
                            delete this.browsers[x][attr];
                        }
                    }
                }
            }
        }
    );
}
/**
 * mDNS cleanup
 * Stop all advertising and browsing
 */
MDNSRegistry.prototype.quit = function() {

    // stop ads
    for (var attr in this.ads) {
        if(this.ads.hasOwnProperty(attr)) {
            this.ads[attr].stop();
        }
    }
    // stop browsers
    ['device', 'fog', 'cloud'].map(
            (x) => {
                for (var attr in this.browsers[x])
                    if(this.browsers[x].hasOwnProperty(attr))
                        this.browsers[x][attr].stop();
            }
    );
}

/**
 * _PRIVATE HELPERS
 */

/**
 * Creates advertisements for the provided attributes
 */
MDNSRegistry.prototype._createAdvertisements = function(attrs, seqval) {
    console.log('mDNS-reg: _createAdvs called, this:', JSON.stringify(this));
    for (var attr in attrs) {
        if (attrs.hasOwnProperty(attr)) {
            // stop advertisement of existing attr (we'll just replace it)
            if (this.ads[attr]) {
                this.ads[attr].stop();
                delete this.ads[attr];
            }
            let name = this.app + '-' + this.type + '-' + attr;
            let txtRecord = {
                    msg: JSON.stringify({
                        data: attrs[attr],
                        seqval: seqval
                    })
                };
            this.ads[attr] = mdns.createAdvertisement(
                mdns.tcp(name), 
                this.port, 
                {name: this.id, txtRecord: txtRecord});
            console.log('Starting adv', JSON.stringify(txtRecord));
            this.ads[attr].start();
            console.log(JSON.stringify(this.ads[attr]));
        }
    }
}
/**
 * Prep a browser to browse for an attibute
 */
MDNSRegistry.prototype._createBrowser = function(attr, type, events) {

    let browser = mdns.createBrowser(
                    mdns.tcp(this.app + '-' + type + '-' + attr),
					{resolverSequence: sequence});
    this.browsers[type][attr] = browser;

    browser.on('serviceUp', function(service) {
        // ignore our own services
        if (service.name == this.id) {
            return;
        }

        // emit a discovery event!
        let parsed = JSON.parse(service.txtRecord.msg);
        if(attr == 'status') {
            this.emit('discovery', attr, events.online, service.name, parsed.data, parsed.seqval);
        } else {
            this.emit('discovery', attr, events.onAdd, service.name, parsed.data, parsed.seqval);
        }
    });
    browser.on('serviceDown', function(service) {
        if(attr == 'status') {
            this.emit('discovery', attr, events.offline, service.name, 'offline', undefined);
        } else {
            this.emit('attr-removed', attr, events.onRemove, service.name);
        }
    });
    browser.on('error', function(err) {
        browser.stop();
        self.emit('browser-error', attr, type, events);
    });

    browser.start();
}

/* exports */
module.exports = MDNSRegistry;
