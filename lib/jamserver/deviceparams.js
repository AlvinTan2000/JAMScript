const Random = require('random-js');
const ps = require('ps-node');

var localStorage;

module.exports = new function () {

	this.init = function (fname) {
		// Create a local storage with 'fname' if there's none
		if (typeof localStorage === 'undefined' || localStorage === null) {
			var LocalStorage = require('node-localstorage').LocalStorage;
			localStorage = new LocalStorage(fname);
		}

		// Check whether if a process is using the port
		var pcsId = localStorage.getItem('processId');
		if (pcsId !== null) {
			ps.lookup({pid: pcsId}, function (err, rl) {
				var rli = rl[0];
				if (rli) {
					console.log("ERROR! Another process is running at port: ", fname);
					process.exit(1);
				}
			});
		}

		// If not store this one there
		localStorage.setItem('processId', process.pid);

		// Assign a randomly-generated value to the deviceId field of the local storage if it is not set
		if (localStorage.getItem('deviceId') === null) {
			var random = new Random(Random.engines.mt19937().autoSeed());
			localStorage.setItem('deviceId', random.uuid4());
		}
	};

	/* Get the value associated with key stored in local storage */
	this.getItem = function (key) {
		return localStorage.getItem(key);
	};

	/* Set a key-value pair in local storage */
	this.setItem = function (key, value) {
		localStorage.setItem(key, value);
	};
};
