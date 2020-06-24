"use strict";

let Redis = require('redis');
let cbor = require('cbor');

// TODO: Remove JSON function?


class JAMBroadcaster {
    /**
     * @param {} channel
     * @param {JAMManager} jammanager
     */
    constructor(channel, jammanager) {
        this.channel = channel;
        this.jammanager = jammanager;
        this.app = jammanager.app;
        this.namespace = 'global';

        this.hooks = [];                    // TODO: What is hooking do?
        this.messages = [];                 /** @type Array.<{Object, String}>**/
        this.lastMessage = null;            /** @type String **/

        // Clock to indicate message sequence number
        this.cloudClock = 0;
        this.fogClock = 0;

        this.transformer = (input) => input;

        // TODO: How does this work
        if (jammanager.getParentInfo() !== null)
            this.subscribeForBroadcast(jammanager.getParentInfo(), jammanager.getParentRedis());
        jammanager.addParentUpSub({func: this.subscribeForBroadcast(), context: this});   //subscribe each object to parent up connection so it can (re)subscribe for broadcasting

        // Check if shared Redis connection is created for all broadcasters
        if (!JAMBroadcaster.broadcaster) {
            this.redisBroadcaster = Redis.createClient({
                host: jammanager.host,
                port: jammanager.port
            });
            JAMBroadcaster.broadcaster = this.redisBroadcaster;
        } else {
            this.redisBroadcaster = JAMBroadcaster.broadcaster
        }

        this.redisBroadcaster.config('SET', ['protected-mode', 'no']);

        // TODO: Why find maximum clock for broadcaster
        // Register this broadcaster with the JAMManager so the broadcaster with the maximum clock can be found
        jammanager.addBroadcaster(this);
    }


    // TODO: Why is the parentRedis subscribing?
    /* Subscribe to upper level Redis domain */
    subscribeForBroadcast(obj, parentRedis) {
        let self = this;

        parentRedis.subscribe(this.getSubscriptionDomain());
        parentRedis.on('message', function (channel, message) {
            if (channel === self.getSubscriptionDomain())
                self.broadcast(message, false);
        });
    }

    addHook(hook) {
        this.hooks.push(hook);
    }

    setTransformer(func) {
        if (typeof func === 'function')
            this.transformer = func;
    }

    getLastValue() {
        return this.lastMessage;
    }

    getClock() {
        return this.cloudClock + '.' + this.fogClock;
    }

    // TODO: What does it actually do?
    getMessageAtClock(clockPack) {
        let messages = [];

        // Parse the clock
        let parts = clockPack.split(".");
        let clock = parseInt(parts[0]);
        let subClock = parts.length > 1 ? (parts[1] === "*" ? "*" : parseInt(parts[1])) : 0;

        // Iterate down from the latest message
        for (let i = this.messages.length - 1; i >= 0; i--) {
            let message = this.messages[i];
            if (message.counter.cloudClock === clock) {

                // TODO: What's *?
                if (subClock === "*" || subClock === message.counter.fogClock) {
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


    broadcast(message, fromSelf) {
        // TODO: what does fromself indicate?
        if (fromSelf) {
            // Parse JSON message if it is
            if (typeof message === "string" && message.indexOf("{") === 0) {
                message = JSON.parse(message);
            }
            // TODO: Why does it take 'this'?
            message = this.transformer(message, this);      // Transform message before sending
            this.lastMessage = message;                     // Update last message

            // Increment appropriate clock depending on level of the broadcaster
            if (this.jammanager.isCloud)
                this.cloudClock++;
            else if (this.jammanager.isFog)
                this.fogClock++;

            // Wrap the message in an object with the counter
            message = {
                counter: {
                    cloudClock: this.cloudClock,
                    fogClock: this.fogClock,
                    from: this.jammanager.deviceID,
                    sourceType: this.jammanager.getLevelCode()
                },
                message: message
            };
            this.messages.push(message);    // Save message
        } else {
            // Unwrap and parse message
            message = message.toString();
            if (typeof message === "string" && message.indexOf("{") === 0) {
                message = JSON.parse(message);
            } else {
                // TODO: How is this actually handled?
                // At this point, all messages should be objects.
                // If it not an object then it must be the cbor encoded message sent from the Fog
                return;
            }

            message.message = this.transformer(message.message);    // Transform message before sending

            // Update clocks and save message
            this.cloudClock = message.counter.cloudClock;
            this.fogClock = message.counter.fogClock;
            this.messages.push(message);

            // Update last message
            if (typeof message.message === "string" && message.message.indexOf("{") === 0)
                this.lastMessage = JSON.parse(message.message);
            else
                this.lastMessage = message.message;
        }

        this._sendMessage(JSON.stringify(message), fromSelf, this.getBroadcastDomain());

        // Send CBOR encoded message for devices
        if (this.jammanager.isDevice || this.jammanager.isFog) {
            let rawMessage = message.message;
            if ((typeof rawMessage === "object" || (typeof rawMessage === "string" && rawMessage.indexOf("{") === 0))) {
                rawMessage = Buffer.from(cbor.encode(rawMessage)).toString('base64');
                this._sendCborMessage(rawMessage, fromSelf, this.getCborBroadcastDomain());
            }
        }
    }

    _sendMessage(message, fromSelf, domain) {
        let data = {
            channel: this.channel,
            app: this.app,
            namespace: this.namespace,
            domain: domain,
            message: this.lastMessage,
            origin: fromSelf ? 'self' : 'parent',
            parent: this.jammanager.getParentInfo(),
            type: this.jammanager.getLevelCode()
        };

//        console.log('Broadcasting ' + message + ' to domain ' + domain + '\n');

        let broadcaster = this.redisBroadcaster;
        let hooks = this.hooks;
        setTimeout(function () {
            hooks.forEach(function (hook) {
                hook(data);
            });
            broadcaster.publish(domain, message);
        }, 0);
    }

    /** @return {String} - The default domain of the JAMBroadcaster */
    getDefaultDomain() {
        return 'aps[' + this.app + '].ns[' + this.namespace + '].bcasts[' + this.channel + ']';
    }

    /** @return {String} **/
    getDefaultCborDomain() {
        return 'aps[' + this.app + '].ns[' + this.namespace + '.cbor].bcasts[' + this.channel + ']';
    }

    /** @return {String} */
    getBroadcastDomain() {
        return this.jammanager.isDevice ? this.getDefaultDomain() : this.getDefaultDomain() + '.' + this.jammanager.getLevelCode();
    }

    /** @return {String} **/
    getCborBroadcastDomain() {
        return this.jammanager.isDevice ? this.getDefaultCborDomain() : this.getDefaultCborDomain() + '.' + this.jammanager.getLevelCode();
    }

    /**
     * @return {String} - The actual domain on the parent that this broadcaster will subscribe to.
     * The parent's level code is appended to the default domain so that same Redis instance can be used for the different levels
     */
    getSubscriptionDomain() {
        let domain = this.getDefaultDomain();
        switch (this.jammanager.getLevelCode()) {
            case "dev":
            case "device":
                domain += ".fog";
                break;
            case "fog":
                domain += ".cloud";
                break;
        }
        return domain;
    }
}

module.exports = JAMBroadcaster;
