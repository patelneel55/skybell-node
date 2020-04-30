'use strict'

const debugLog = require('util').debuglog('skybell-js');

let SkyBellSession = require('./lib/session.js');

class SkyBell {

    constructor(username, password) {
        if(!username || !password)
            throw Error("Username or password is missing.");

        this.skyBellDevices = [];

        this.skybellSession = new SkyBellSession(username, password, {
            callback: (id, deviceObj) => this.skyBellDevices.push({id: id, deviceInstance: deviceObj})
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
            else
                callback(err, response);
        });
    }

    startCameraStream(deviceId, activity, callback) {

    }

    stopCameraStream(deviceId) {
        
    }
}

let skybell = new SkyBell("patelfamily005@gmail.com", "Tn04365!");

skybell.getDevices((err, data) => {
    for(let a of data){
        a.deviceInstance.getActivities((err, body) => console.log(body))
    }
    // console.log(data);
})