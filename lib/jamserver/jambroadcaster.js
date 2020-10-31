// TODO: Fix glitch of broadcasting speed doubling upon ebus up

class JAMBroadcaster {
    static jBcasterList = []        /** @type {Array.<JAMBroadcaster>} **/

    /**
     * @param {String} channel
     * @param {JAMManager} jammanager
     */
    constructor(channel, jammanager) {
        JAMBroadcaster.jBcasterList.push(this);

        this.channel = channel;                 // Name of the broadcaster
        this.namespace = 'global';              // Broadcaster namespace
        this.jammanager = jammanager;

        this.hooks = [];                        // Functions for saving broadcasted data
        this.lastMsg = null;                    // Last message broadcasted
        this.bcastedMsg = [];                   // History of broadcasted messages
        this.fogClock = 0;                      // Clock for message at fog level
        this.cloudClock = 0;                    // Clock for message at cloud level
        this.transformer = (input) => input;    // Message transformer

        /** Build broadcast and subscription domain for Pub/Sub **/

            // Default naming convention
        let defDomain = 'aps[' + this.jammanager.app + '].ns[' + this.namespace + '].bcasts[' + this.channel + ']';

        // Broadcast channel : Append level code
        this.bcastDomain = defDomain;
        if (this.jammanager.getLevelCode() != "device") {
            this.bcastDomain += '.' + this.jammanager.getLevelCode();
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
        this.listenBcast();
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

    /**
     * Broadcast message after handling (ie. transforming, saving and constructing)
     * @param message : Object
     * @param isLocal : boolean - Indicates if the message is locally injected or was received from above hierarchy
     */
    broadcast(message, isLocal) {
        isLocal = isLocal !== false ? true : isLocal;

        let from, source;

        if (isLocal) {
            this.lastMsg = this.transformer(message, this);

            // Increment clock
            if (this.jammanager.level == 'cloud')
                this.cloudClock++;
            else if (this.jammanager.level == 'fog')
                this.fogClock++;

            from = this.jammanager.deviceID;
            source = this.jammanager.getLevelCode()
        } else {
            this.lastMsg = message.message;

            // Update clock
            this.cloudClock = message.counter.cloudClock;
            this.fogClock = message.counter.fogClock;

            // Get the origin information
            from = message.from
            source = message.sourceType;
        }

        // Wrap the message in an object and save the message
        let msgObj = {
            counter: {
                cloudClock: this.cloudClock,
                fogClock: this.fogClock,
                from: from,
                sourceType: source
            },
            message: this.lastMsg
        };
        this.bcastedMsg.push(msgObj);

        // Creating current scope variables for anonymous functions
        let jamredis = this.jammanager.jamredis;
        let bcastDomain = this.bcastDomain;
        let hooks = this.hooks;

        // Data to be hooked
        let data = {
            message: this.lastMsg,
            channel: this.channel,
            domain: this.bcastDomain,
            app: this.jammanager.app,
            namespace: this.namespace,
            origin: isLocal ? 'self' : 'parent',
            type: this.jammanager.getLevelCode()
        };
        // Asynchronously execute the following
        setTimeout(function () {
            // Hook/Save the data
            hooks.forEach(function (hook) {
                hook(data);
            });
            // Broadcast the data through JAMRedis
            jamredis.broadcastData(bcastDomain, msgObj);
        }, 0);
    }


    // TODO: Consider hashing response to map the appropriate JAMBroadcaster
    listenBcast() {
        let self = this;

        this.jammanager.jamredis.subscribeData(this.listenDomain, function (channel, result) {
            if (channel == self.listenDomain)
                self.broadcast(result, false);
        })
    }

    /** Static method for letting all JAMBroadcasters to subscribe triggered by event bus "UP" events **/
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