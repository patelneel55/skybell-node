'use strict'

const debugLog = require('util').debuglog('skybell-device');

module.exports = class SkyBellDevice {

    constructor(api, device) {
        this.api = api
        this.deviceId = device.id;
        this.deviceName = device.name;

        // Debug device info
        if (process.env.NODE_DEBUG && ('skybell-device').match(process.env.NODE_DEBUG)) {
            this.getDeviceInfo((err, body) => {
                debugLog("SkyBell '" + this.deviceName + "' Wi-Fi status: "
                    + ' Quality=' + body.status.wifiLink
                    + ", SSID='" + body.essid + "'"
                    + ', RSSI=' + body.wifiSignalLevel + 'dBm'
                    + ', Noise=' + body.wifiNoise + 'dBm'
                    + ', SNR=' + body.wifiSnr + 'dB'
                    + ', Quality=' + body.wifiLinkQuality + '%'
                    + ', Rate=' + body.wifiBitrate + 'Mbps)');
            })
        }
    }

    getDeviceId() {
        return this.deviceId
    }

    getDeviceName() {
        return this.deviceName
    }

    getDeviceInfo(callback) {
        this.api.getInfoByDevice(this.deviceId, (err, body) => {
            // Process the information
            if (err) {
                debugLog("Failed to retrieve Skybell '" + this.deviceName + "' device information: " + err);
                callback(err, null);
            }
            else
                callback(null, body);
        });
    }

    getActivities(callback) {
        this.api.getActivitiesByDevice(this.deviceId, (err, body) => {
            // Process the activities
            if (err) {
                debugLog("Failed to retrieve SkyBell '" + this.deviceName + "' device activities: " + err)
                callback(err, null);
            }
            else
                callback(null, body);
        });
    }

    getVideoUrl(activityId, callback) {
        this.api.getActivityVideoByDevice(this.deviceId, activityId,
            (err, body) => {
                if (err) {
                    debugLog("Failed to retrieve video " + activityId + " from SkyBell '" + this.deviceName + "': " + err);
                    callback(err, null);
                }
                callback(err, body.url);
            });
    }

    // Start a call
    startCall(id, callback, attempt = 1) {
        this.api.startCallByDevice(this.deviceId, (err, body) => {
            if (err && (attempt < this.options.callRetries)) {
                debugLog("Retrying call to SkyBell '" + this.name
                    + "' " + id + ': ' + err);
                return this.startCall(id, callback, attempt + 1);
            }
            if (err) {
                debugLog("Failed to start call to SkyBell '" + this.name
                    + "' " + id + ': ' + err);
            }
            callback(err, body);
        });
    }

    // End a call
    stopCall(id, callback) {
        this.api.stopCallByDevice(this.deviceId, (err, body) => {
            if (err) {
                debugLog("Failed to stop call to SkyBell '" + this.name
                    + "' " + id + ': ' + err);
            }
            callback(err);
        });
    }
}