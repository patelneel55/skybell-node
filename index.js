'use strict'

const debugLog = require('util').debuglog('skybell-js');

let SkyBellSession = require('./lib/session.js');
let SkyBellCameraStream = require('./lib/stream.js');

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
        let deviceObj;
        for(let i = 0;i < this.skyBellDevices.length;i++)
        {
            if(this.skyBellDevices[i].id == deviceId)
            {
                deviceObj = this.skyBellDevices[i].deviceInstance;
            }
        }

        if(!deviceObj)
        {
            debugLog("Device not found.");
            callback(new Error("Device not found"), null);
        }
        else
        {
            let stream = new SkyBellCameraStream(deviceObj);

            stream.startCall(undefined, (err) => {
                if(err)
                debugLog("Failed to initiate call to '"
                + this.name + "': " + err);
            });
        }
    }

    stopCameraStream(deviceId) {
        
    }
}

let skybell = new SkyBell("patelfamily005@gmail.com", "Tn04365!");

skybell.getDevices((err, data) => {
    // for(let a of data){
    //     // a.deviceInstance.getActivities((err, body) => console.log(body))
    // }
    // console.log(data);
    skybell.startCameraStream('5a296a19284d9c000719f3b1', undefined, (err) => {
        console.log("TEMP: " + err);
    })
})

