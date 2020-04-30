// Copyright © 2017 Alexander Thoukydides

'use strict';

const debugLog = require('util').debuglog('skybell-api');

let request = require('request');
let uuid = require('uuid4');

const SKYBELL_URL = 'https://cloud.myskybell.com/api/v3/';

let instanceCount = 0;

module.exports = class SkyBellAPI {

    constructor(username, password) {

        this.credentials = {
            username: username,
            password: password
        };

        // Initialize access token
        this.access_token = null;
        this.instance = ++instanceCount
        this.requestCount = 0;

        // Generate random UUID 
        this.appuuid = uuid();
        this.clientuuid = uuid();
    }

    // Login to the SkyBell cloud
    login(callback) {
        this.requestRaw('POST', 'login/', this.credentials, (err, response) => {
            if (err)
                callback(err);
            else if (response.access_token) {
                this.access_token = response.access_token;
                callback(null, response);
            }
            else
                callback(new Error('No access token returned'));
        });
    }

    // Logout from the SkyBell cloud
    logout(callback) {
        this.request('POST', 'logout', { appId: this.appuuid }, callback);
    }

    // List of application
    getAppInstalls(userId, callback) {
        this.request('GET', 'users/' + userId + '/app_installs/', null, callback);
    }

    // Get application subscription settings
    getAppInstallSettings(userId, appId, subscriptionId, callback) {
        this.request('GET', 'users/' + userId + '/app_installs/' + appId
            + '/subscriptions/' + subscriptionId + '/settings',
            null, callback);
    }

    // Register and unregister an application
    registerApp(protocol, token, callback) {
        this.request('POST', 'register', {
            appId: this.appUuid,
            protocol: protocol,
            token: token
        }, callback);
    }
    unregisterApp(callback) {
        this.request('POST', 'unregister', { appId: this.appUuid }, callback);
    }

    // Get information about a user
    getUserMe(callback) {
        this.request('GET', 'users/me/', null, callback);
    }
    getUser(userId, callback) {
        this.request('GET', 'users/' + userId, null, callback);
    }

    // Get list of all subscriptions or devices
    getSubscriptions(callback) {
        this.request('GET', 'subscriptions?include=owner', null, callback);
    }
    getDevices(callback) {
        this.request('GET', 'devices/', null, callback);
    }

    // Get information about a device
    getInfoBySubscription(subscriptionId, callback) {
        this.request('GET', 'subscriptions/' + subscriptionId + '/info/', null, callback);
    }
    getInfoByDevice(deviceId, callback) {
        this.request('GET', 'devices/' + deviceId + '/info/', null, callback);
    }

    // Get device settings
    getSettingsBySubscription(subscriptionId, callback) {
        this.request('GET', 'subscriptions/' + subscriptionId + '/settings/', null, callback);
    }
    getSettingsByDevice(deviceId, callback) {
        this.request('GET', 'devices/' + deviceId + '/settings/', null, callback);
    }

    // Change any combination of device settings
    setSettingsBySubscription(subscriptionId, settings, callback) {
        this.request('PATCH', 'subscriptions/' + subscriptionId + '/settings/', settings, callback);
    }
    setSettingsByDevice(deviceId, settings, callback) {
        this.request('PATCH', 'devices/' + deviceId + '/settings/', settings, callback);
    }

    // Get the avatar URL for a device
    getAvatarBySubscription(subscriptionId, callback) {
        this.request('GET', 'subscriptions/' + subscriptionId + '/avatar/', null, callback);
    }
    getAvatarByDevice(deviceId, callback) {
        this.request('GET', 'devices/' + deviceId + '/avatar/', null, callback);
    }

    // Get a list of activities (with still images)
    getActivitiesBySubscription(subscriptionId, callback) {
        this.request('GET', 'subscriptions/' + subscriptionId + '/activities/', null, callback);
    }
    getActivitiesByDevice(deviceId, callback) {
        this.request('GET', 'devices/' + deviceId + '/activities/', null, callback);
    }

    // Get the video URL for an activity
    getActivityVideoBySubscription(subscriptionId, callId, callback) {
        this.request('GET', 'subscriptions/' + subscriptionId + '/activities/' + callId + '/video/', null, callback);
    }
    getActivityVideoByDevice(deviceId, callId, callback) {
        this.request('GET', 'devices/' + deviceId + '/activities/' + callId + '/video/', null, callback);
    }

    // Start and stop live SRTP streams (video in, audio in, and audio out)
    startCallByDevice(deviceId, callback) {
        this.request('POST', 'devices/' + deviceId + '/calls/', null, callback);
    }
    stopCallByDevice(deviceId, callback) {
        this.request('DELETE', 'devices/' + deviceId + '/calls/', null, callback);
    }

    // Issue a request to the SkyBell cloud, logging in if required
    request(method, path, body, callback) {
        if (!this.access_token) {
            // No access token, so try to login first
            this.login(err => {
                if (err)
                    callback(err);
                else
                    this.request(method, path, body, callback);
            });
        } else {
            // Try the request with the current access token
            this.requestRaw(method, path, body, (err, body) => {
                if (err) {
                    if (err.message.indexOf('SmartAuth') != -1) {
                        // Authentication failure, so try to login again
                        this.login(err => {
                            if (err)
                                callback(err)
                            else
                                this.request(method, path, body, callback);
                        });
                    } else {
                        // Failed, but not due to authentication
                        callback(err);
                    }
                } else {
                    // Success
                    callback(null, body);
                }
            });
        }
    }

    // Issue a raw request to the SkyBell cloud
    requestRaw(method, path, body, callback) {
        let options = {
            method: method,
            url: SKYBELL_URL + path,
            json: true,
            headers: {
                Authorization: 'Bearer ' + this.access_token,
                'x-skybell-app-id': this.appuuid,
                'x-skybell-client-id': this.clientuuid
            }
        };
        if (body) options.body = body;

        // Issue the request
        let logPrefix = 'Cloud API request #' + this.instance + '-'
            + ++this.requestCount + ': ';
        debugLog(logPrefix + method + ' /' + path);
        let startTime = Date.now();
        request(options, (err, response, body) => {
            // Check for errors
            debugLog(logPrefix
                + (err || response.statusMessage)
                + ' +' + (Date.now() - startTime) + 'ms ');
            if (response && response.statusCode < 400) {
                return callback(null, body);
            }

            // Attempt to extract a useful error message
            let msg = err || response.statusMessage;
            if (body) {
                let e = body.errors || body.error || body;
                msg = e.message || e.name || JSON.stringify(e);
            }
            callback(new Error('SkyBell API error: ' + msg));
        });
    }
}
