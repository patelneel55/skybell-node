'use strict'

const debugLog = require('util').debuglog('skybell-session');

let SkyBellAPI = require('./api.js');
let SkyBellDevice = require('./device.js');

module.exports = class SkyBellSession {
    
    constructor(username, password, options = {}) {

        this.api = new SkyBellAPI(username, password);
        this.options  = options
        
        this.getDevices((err, data) => {});
    }

    // Periodically poll the list of SkyBell devices
    getDevices(callback) {
        this.api.getDevices((err, response) => {
            // Process the list of devices
            if (err)
            {
                debugLog('Unable to enumerate SkyBell devices: ' + err);
                callback(err, null);
            }
            else
            {
                let deviceList = [];
                response.forEach(device => {
                    debugLog("Discovered SkyBell '" + device.name + "': device_id=" + device.id);

                    deviceList.push({id: device.id, deviceInstance: new SkyBellDevice(this.api, device)});

                    if(this.options.callback)
                        this.options.callback(device.id, deviceList[device.id]);
                })

                callback(null, deviceList);
            }
        });
    }
}