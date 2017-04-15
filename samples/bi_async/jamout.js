var jamlib = require('/usr/local/share/jam/lib/jserver/jamlib');
var jnode = require('/usr/local/share/jam/lib/jserver/jnode');
var http = require('http');
var cbor = require('cbor');
var qs = require('querystring');
var path = require('path');
var mime = require('mime');
var fs = require('fs');
var wait = require('wait.for-es6');
function* main() {
var jcondition = new Map();
var counter = 0;
function pong() {
jnode.machAsyncExec("callpong", [  ], "true", 0);
}

function callpong() {
counter = counter + 1;
;
console.log("pong..", counter);
ping();

}
function ping() {
jnode.remoteAsyncExec("ping", [  ], "true", 0);
}

var mbox = {
"functions": {
"pong": callpong,
},
"signatures": {
"pong": "",
}
}
jamlib.registerFuncs(mbox);
jamlib.run(function() { console.log("Running..."); } );
}
wait.launchFiber(main);
