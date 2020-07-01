/**
 * Created by Richboy on 03/07/17.
 */

"use strict";

let Redis = require('redis');
let cbor = require('cbor');

class JAMBroadcaster {
    /**
     * @param {} channel
     * @param {JAMManager} jammanager
     */
    constructor(channel, jammanager) {
        console.log("Created JAMBroadcaster");

        this.channel = channel;
        this.jammanager = jammanager;
        this.app = jammanager.app;
        this.namespace = 'global';

        this.hooks = [];
        this.messages = [];
        /** @type Array.<{Object, String}>**/
        this.lastValue = null;  /** @type String **/

        // Clock to indicate message sequence number
        this.cloudClock = 0;
        this.fogClock = 0;

        this.transformer = (input) => input;

        if (jammanager.getParentInfo() !== null)
            this.subForBroadcast(jammanager.getParentInfo(), jammanager.getParentRedis());
        jammanager.addParentUpSub({func: this.subForBroadcast, context: this});   //subscribe each object to parent up connection so it can (re)subscribe for broadcasting

        this.broadcaster = JAMBroadcaster.broadcaster ? JAMBroadcaster.broadcaster : Redis.createClient({
            host: jammanager.host,
            port: jammanager.port
        });

        // let all instances of the broadcaster share same Redis connection
        if (!JAMBroadcaster.broadcaster)
            JAMBroadcaster.broadcaster = this.broadcaster;

        this.broadcaster.config(['set', 'protected-mode', 'no']);

        // Register this broadcaster with the JAMManager so the broadcaster with the maximum clock can be found
        jammanager.addBroadcaster(this);
    }

    subForBroadcast(obj, parentRedis) {
        console.log("JAMBroadcaster subscribeForBroadcast");
        let self = this;

        parentRedis.subscribe(this.getSubscriptionDomain());
        parentRedis.on('message', function (channel, message) {
            console.log("JAMBroadcaster message");
            if (channel == self.getSubscriptionDomain())
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
        return this.lastValue;
    }

    getClock() {
        return this.cloudClock + '.' + this.fogClock;
    }

    getMessageAtClock(clockPack) {
        let messages = [];

        // Parse the clock
        let parts = clockPack.split(".");
        let cloudClock = parseInt(parts[0]);
        let fogClock = parts.length > 1 ? (parts[1] === "*" ? "*" : parseInt(parts[1])) : 0;

        // Iterate down from the latest message
        for (let i = this.messages.length - 1; i >= 0; i--) {
            let message = this.messages[i];
            if (message.counter.clock == cloudClock) {
                if (fogClock === "*" || fogClock == message.counter.subClock) {
                    messages.push(message.message);
                    if (fogClock !== "*")
                        break;
                }
            }
        }

        if (messages.length === 0)
            return null;
        if (fogClock !== "*")
            return messages[0];
        return messages;
    }

    broadcast(message, fromSelf) {
        console.log("JAMBroadcaster broadcast");
        let msgbuf, mess;
        fromSelf = fromSelf !== false ? true : fromSelf;

        if (fromSelf) {
            if (typeof message === "string" && message.indexOf("{") === 0)
                message = JSON.parse(message);

            //transform message before sending
            message = this.transformer(message, this);

            this.lastValue = message;

            if (this.jammanager.isCloud)
                this.cloudClock++;
            else if (this.jammanager.isFog)
                this.fogClock++;

            //wrap the message in an object with the counter
            message = {
                counter: {
                    clock: this.cloudClock,
                    subClock: this.fogClock,
                    from: this.jammanager.deviceID,
                    sourceType: this.jammanager.getLevelCode()
                },
                message: message
            };
            this.messages.push(message);    //save message

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

            this.cloudClock = message.counter.clock;
            this.fogClock = message.counter.subClock;
            this.messages.push(message);    //save message

            if (typeof message.message === "string" && message.message.indexOf("{") === 0)
                this.lastValue = JSON.parse(message.message);
            else
                this.lastValue = message.message;
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

    _sendMessage(message, fromSelf) {
        let channel = this.channel;
        let namespace = this.namespace;
        let app = this.app;
        let broadcaster = this.broadcaster;
        let domain = this.getBcastDom();
        let hooks = this.hooks;

        let data = {
            channel: channel,
            app: app,
            namespace: namespace,
            domain: domain,
            message: this.lastValue,
            origin: fromSelf ? 'self' : 'parent',
            parent: this.jammanager.getParentInfo(),
            type: this.jammanager.getLevelCode()
        };

//        console.log('Broadcasting ' + message + ' to domain ' + domain + '\n');

        setTimeout(function () {
            hooks.forEach(function (hook) {
                hook(data);
            });
            console.log("JAMBroadcaster publish");
            broadcaster.publish(domain, message);
        }, 0);
    }


    _sendCborMessage(message, fromSelf) {
        let channel = this.channel;
        let namespace = this.namespace;
        let app = this.app;
        let broadcaster = this.broadcaster;
        let domain = this.getCborBcastDom();
        let hooks = this.hooks;

        let data = {
            channel: channel,
            app: app,
            namespace: namespace,
            domain: domain,
            message: this.lastValue,
            origin: fromSelf ? 'self' : 'parent',
            parent: this.jammanager.getParentInfo(),
            type: this.jammanager.getLevelCode()
        };

//        console.log('Broadcasting ' + message + ' to domain ' + domain + '\n');

        setTimeout(function () {
            hooks.forEach(function (hook) {
                hook(data);
            });
            broadcaster.publish(domain, message);
        }, 0);
    }


    //This is the default domain which this jambroadcaster is about
    /** @return {String} - The default domain of the JAMBroadcaster */
    getDefDom() {
        return 'aps[' + this.app + '].ns[' + this.namespace + '].bcasts[' + this.channel + ']';
    }

    /** @return {String} **/
    getDefCborDom() {
        return 'aps[' + this.app + '].ns[' + this.namespace + '.cbor].bcasts[' + this.channel + ']';
    }

    /** @return {String} **/
    getBcastDom() {
        return this.jammanager.isDevice ? this.getDefDom() : this.getDefDom() + '.' + this.jammanager.getLevelCode();

    }

    /** @return {String} **/
    getCborBcastDom() {
        return this.jammanager.isDevice ? this.getDefCborDom() : this.getDefCborDom() + '.' + this.jammanager.getLevelCode();
    }

    /**
     * @return {String} - The actual domain on the parent that this broadcaster will subscribe to.
     * The parent's level code is appended to the default domain so that same Redis instance can be used for the different levels
     */
    getSubscriptionDomain() {
        let domain = this.getDefDom();
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
