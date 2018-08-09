//===================================================================
// This is the main JAMLib module. It implements a generic set of
// functionality that makes it suitable for implementing the J nodes
<<<<<<< HEAD
// at the different levels: cloud, fog, and device. 
=======
// at the different levels: cloud, fog, and device.
>>>>>>> JAMScript-beta/master
//===================================================================

// Load the global modules
const mqtt = require('mqtt'),
<<<<<<< HEAD
	  os = require('os');

// Do command line processing...
var cmdParser = require('./cmdparser');
var cmdopts = cmdParser();

// Get or make device parameters like device_id
var deviceParams = require('./deviceparams');
deviceParams.init(cmdopts.conf);

// Get or make the machine registry. There could be a remote
// server as well. In that case, local storage is the cache...
var machRegistry = require('./machregistry');
machRegistry.init(cmdopts, deviceParams);

var jcond = require('./jcond');

// Setup update of the address every 1 minute
setInterval(function() {
	machRegistry.update();
	jcond.reinit(machRegistry);
}, 60000);
// Update the address to begin the process.
machRegistry.update();
jcond.init(machRegistry);

var jnode = require('./jnode');
jnode.init(machRegistry.type);

console.log("Initialized JAMLib.");
=======
	  os = require('os'),
      globals = require('./constants').globals;

// Do command line processing...
var cmdopts = require('./cmdparser');

// Get or make device parameters like device_id
var deviceParams = require('./deviceparams');
deviceParams.init(cmdopts.port);

// initialize the error logger
var logger = require('./jerrlog');
logger.init(cmdopts.app, false);

// create the Registrar
var Registrar = require('jdiscovery');
var machType = getMachineType(cmdopts);
deviceParams.setItem('machType', machType);

var reggie = new Registrar(cmdopts.app, machType, deviceParams.getItem('deviceId'),
						cmdopts.port, {long: cmdopts.long, lat: cmdopts.lat}, { protocols: { mqtt: false, mdns: true, localStorage: false } });

var jamsys = require('./jamsys');
jamsys.init(reggie, machType, cmdopts.tags, cmdopts.iflow, cmdopts.oflow, deviceParams.getItem('deviceId'),
								cmdopts.link, cmdopts.long, cmdopts.lat);
jamsys.setMQTT(getMachineAddr(), cmdopts.port);


var jnode = require('./jnode');
jnode.init(reggie, machType);

>>>>>>> JAMScript-beta/master

module.exports = new function() {
	this.registerFuncs = registerFuncs;
	this.run = run;
<<<<<<< HEAD
};
=======
}
>>>>>>> JAMScript-beta/master

function run(callback) {

	// Check the presence of the MQTT server.
	// If not, report an error and quit
<<<<<<< HEAD
=======

>>>>>>> JAMScript-beta/master
	checkMQTTServer(function(present) {
		if (!present) {
			console.log("ERROR! Cannot connect to MQTT server. Exiting.");
			process.exit(1);
		}

<<<<<<< HEAD
		if (machRegistry.type === 'CLOUD') {
=======
        if (machType === globals.NodeType.CLOUD) {
            reggie.registerAndDiscover();
>>>>>>> JAMScript-beta/master
			jnode.startService();
			jnode.startRunner();
		} else {
			jnode.doRegister();
			jnode.startService();
			jnode.startRunner();
<<<<<<< HEAD
=======

>>>>>>> JAMScript-beta/master
		}

		if (callback !== undefined)
			callback();
	});

}

function registerFuncs(machbox) {

<<<<<<< HEAD
	// Register all callbacks in the machbox. 
	// These are functions registered by the application
	fkeys = Object.keys(machbox.functions);
	for (var i in fkeys) {
		tkey = fkeys[i];		
=======
	// Register all callbacks in the machbox.
	// These are functions registered by the application
	fkeys = Object.keys(machbox.functions);
	for (i in fkeys) {
		tkey = fkeys[i];
>>>>>>> JAMScript-beta/master
		jnode.registerCallback(tkey, machbox.functions[tkey], machbox.signatures[tkey]);
	}
}

<<<<<<< HEAD
// Check whether the MQTT server is up and running.. 
function checkMQTTServer(callback) {
	var tserv = mqtt.connect("mqtt://localhost:" + cmdopts.port );
	tserv.on('connect', function () {
		callback(true);
		tserv.end();
	});
	tserv.on('offline', function() {
		callback(false);
		tserv.end();
	});
}
=======
// Check whether the MQTT server is up and running..
function checkMQTTServer(callback) {
	var tserv = mqtt.connect("mqtt://localhost:" + cmdopts.port );
	tserv.on('connect', function() {
		tserv.end();
		callback(true);
	});
	tserv.on('offline', function() {
        tserv.end();
		callback(false);
	});
}


function getMachineType(copts) {

    if (copts.device) {
        machType = globals.NodeType.DEVICE;
    } else if (copts.fog) {
        machType = globals.NodeType.FOG;
    } else if (copts.cloud) {
        machType = globals.NodeType.CLOUD;
    } else {
        throw new Error('no machine type specified - must be one of \'device\', \'fog\', or \'cloud\'');
    }

    return machType;
}


function getMachineAddr() {
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
>>>>>>> JAMScript-beta/master
