'use strict'

const debugLog = require('util').debuglog('skybell');

let SkyBellSession = require('./lib/session.js');

class SkyBell {

    constructor(username, password) {
        if(!username || !password)
            throw Error("Username or password is missing.");

        this.skyBellDevices;

        this.skybellSession = new SkyBellSession(username, password, {
            callback: (id, deviceObj) => this.skyBellDevices[id] = deviceObj
        });

        debugLog("SkyBell session created successfully.");
    }

    getDevices(callback) {
        this.skybellSession.getDevices((err, response) => {

            if(err && this.skyBellDevices)
            {
                debugLog('Failed to check for new devices but returning last queried devices: ' + err);
                callback(null, this.skyBellDevices);
            }
            
            if(response)
            {
                this.skyBellDevices = response;
                callback(null, response);
            }

            callback(err, response);
        });
    }

    startCameraStream(deviceId, activity, callback) {

    }

    stopCameraStream(deviceId) {
        
    }
}