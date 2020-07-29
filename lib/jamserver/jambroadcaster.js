var Redis = require('redis');
var cbor = require('cbor');

class JAMBroadcaster {
    /** @type {Array.<JAMBroadcaster>} **/
    static jBcasterList = []

    /**
     * @param {String} channel
     * @param {JAMManager} jammanager
     */
    constructor(channel, jammanager) {
        JAMBroadcaster.jBcasterList.push(this);

        this.jammanager = jammanager;
        this.jamredis = jammanager.jamredis;
        this.app = jammanager.app;              // Name of the program
        this.channel = channel;                 // Name of the broadcaster
        this.namespace = 'global';              // Broadcaster namespace

        this.hooks = [];
        this.bcastedMsg = [];                   // History of broadcasted messages
        this.lastMsg = null;                    // Last message broadcasted
        this.fogClock = 0;                      // Clock for message at fog level
        this.cloudClock = 0;                    // Clock for message at cloud level
        this.transformer = (input) => input;    // Message transformer

        /** Build broadcast and subscription domain for Pub/Sub **/

        // Default naming convention
        let defDomain = 'aps[' + this.app + '].ns[' + this.namespace + '].bcasts[' + this.channel + ']';
        let defCborDomain = 'aps[' + this.app + '].ns[' + this.namespace + '.cbor].bcasts[' + this.channel + ']';

        // Broadcast channel : Append level code
        this.bcastDomain = defDomain;
        this.bcastCborDomain = defCborDomain;
        if (!this.jammanager.isDevice) {
            this.bcastDomain += '.' + this.jammanager.getLevelCode();
            this.bcastCborDomain += '.' + this.jammanager.getLevelCode();
        }

        // Subscription channel :
        this.listenDomain = '';
        switch (this.jammanager.getLevelCode()) {
            case "dev":
            case "device":
                this.listenDomain = defDomain + ".fog";
                break;
            case "fog":
                this.listenDomain = defDomain + ".cloud";
                break;
        }

        // TODO: Handle failover to prevent duplicate subscription
        /** Parent connection **/
        if (this.jamredis.getParentCon() !== null) {
            this.listenBcast();
        }
    }


    addHook(hook) {
        this.hooks.push(hook);
    }

    setTransformer(func) {
        if (typeof func === 'function')
            this.transformer = func;
    }

    getLastValue() {
        return this.lastMsg;
    }

    getClock() {
        return this.cloudClock + '.' + this.fogClock;
    }

    getMessageAtClock(clockPack) {
        let parts = clockPack.split(".");
        let clock = parseInt(parts[0]);
        let subClock = parts.length > 1 ? (parts[1] === "*" ? "*" : parseInt(parts[1])) : 0;

        let messages = [];

        for (let i = this.bcastedMsg.length - 1; i >= 0; i--) {    //start from the current position and go down the array
            let message = this.bcastedMsg[i];
            if (message.counter.cloudClock == clock) {
                if (subClock === "*" || subClock == message.counter.fogClock) {
                    messages.push(message.message);
                    if (subClock !== "*")
                        break;
                }
            }
        }

        if (messages.length === 0)
            return null;
        if (subClock !== "*")
            return messages[0];
        return messages;
    }


    // TODO: Remove JSON Parsing
    // TODO: Maybe merge the following three functions
    broadcast(message, fromSelf) {
        let msgbuf, mess;
        fromSelf = fromSelf !== false ? true : fromSelf;

        if (fromSelf) {
            if (typeof message === "string" && message.indexOf("{") === 0)
                message = JSON.parse(message);

            //transform message before sending
            message = this.transformer(message, this);

            this.lastMsg = message;

            if (this.jammanager.isCloud)
                this.cloudClock++;
            else if (this.jammanager.isFog)
                this.fogClock++;

            //wrap the message in an object with the counter
            message = {
                counter: {
                    cloudClock: this.cloudClock,
                    fogClock: this.fogClock,
                    from: this.jammanager.deviceID,
                    sourceType: this.jammanager.getLevelCode()
                },
                message: message
            };
            this.bcastedMsg.push(message);    //save message

            //console.log(message);
        } else {   //this can only be a fog or device
            message = message.toString();
            //unwrap message and update broadcaster clock
            if (typeof message === "string" && message.indexOf("{") === 0)
                message = JSON.parse(message);
            else// if( typeof message !== "object" )
                return; //at this point, all messages should be objects. If it not an object then it must be the cbor encoded message sent from the Fog

            //transform message before sending
            message.message = this.transformer(message.message);

            this.cloudClock = message.counter.cloudClock;
            this.fogClock = message.counter.fogClock;
            this.bcastedMsg.push(message);    //save message

            if (typeof message.message === "string" && message.message.indexOf("{") === 0)
                this.lastMsg = JSON.parse(message.message);
            else
                this.lastMsg = message.message;
        }

        mess = JSON.stringify(message);
        this._sendMessage(mess, fromSelf);

        if (this.jammanager.isDevice || this.jammanager.isFog) { //send unwrapped message for devices
            let rawMessage = message.message;
            if ((typeof rawMessage === "object" || (typeof rawMessage === "string" && rawMessage.indexOf("{") === 0))) {
                rawMessage = cbor.encode(rawMessage);
                msgbuf = Buffer.from(rawMessage);
                rawMessage = msgbuf.toString('base64');
                this._sendCborMessage(rawMessage, fromSelf);
            }
        }
    }

    // TODO: To be removed
    _sendMessage(message, fromSelf) {
        // Create data object
        let data = {
            channel: this.channel,
            app: this.app,
            namespace: this.namespace,
            domain: this.bcastDomain,
            message: this.lastMsg,
            origin: fromSelf ? 'self' : 'parent',
            parent: this.jamredis.getParentCon(),
            type: this.jammanager.getLevelCode()
        };

        // Creating current scope variables for anonymous functions
        let jamredis = this.jamredis;
        let bcastDomain = this.bcastDomain;
        let hooks = this.hooks;
        // Asynchronously execute the following
        setTimeout(function () {
            // Hook/Save the data
            hooks.forEach(function (hook) {
                hook(data);
            });
            // Broadcast the data through JAMRedis
            jamredis.broadcastData(bcastDomain, message);
        }, 0);
    }

    _sendCborMessage(message, fromSelf) {
        // Create data object
        let data = {
            channel: this.channel,
            app: this.app,
            namespace: this.namespace,
            domain: this.bcastCborDomain,
            message: this.lastMsg,
            origin: fromSelf ? 'self' : 'parent',
            parent: this.jamredis.getParentCon(),
            type: this.jammanager.getLevelCode()
        };

        // Creating current scope variables for anonymous functions
        let jamredis = this.jamredis;
        let domain = this.bcastCborDomain();
        let hooks = this.hooks;
        // Asynchronously execute the following
        setTimeout(function () {
            // Hook/Save the data
            hooks.forEach(function (hook) {
                hook(data);
            });
            // Broadcast the data through JAMRedis
            jamredis.broadcastData(domain, message);
        }, 0);
    }

    // TODO: Consider implement a hash map of domain -> broadcaster to prevent "waking" every broadcaster
    listenBcast() {
        var self = this;

        this.jamredis.subscribeData(this.listenDomain, function (ch, resp) {
            if (ch == self.listenDomain)
                self.broadcast(resp, false);
        })
    }

    /** Static method for triggered by event bus "UP" events **/
    static parentUpSub() {
        JAMBroadcaster.jBcasterList.forEach(function (jBcaster) {
            jBcaster.listenBcast();
        })
    }


    static getMaxClock() {
        let jBcasterList = JAMBroadcaster.jBcasterList;

        if (jBcasterList.length === 0)
            return null;

        let max = {cloudClock: jBcasterList[0].cloudClock, fogClock: jBcasterList[0].fogClock};
        for (let broadcaster of jBcasterList) {
            if (broadcaster.cloudClock > max.cloudClock || (broadcaster.cloudClock == max.cloudClock && broadcaster.fogClock > max.fogClock)) {
                max.clock = broadcaster.cloudClock;
                max.subClock = broadcaster.fogClock;
            }
        }
        return max.cloudClock + '.' + max.fogClock;
    }
}

module.exports = JAMBroadcaster;