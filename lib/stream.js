// Copyright © 2017, 2018 Alexander Thoukydides

'use strict'

const debugLog = require('util').debuglog('skybell-stream');

let ip = require('ip');
let spawn = require('child_process').spawn;
let dgram = require('dgram');
let fs = require('fs');

// SkyBell supports a maximum of 30fps, but dynamically adjusts to suit the link
const MAX_FPS = 30;

// SkyBell supports 1080p, 720p or 480p, all 16:9 widescreen
const VIDEO_RESOLUTIONS = [
    [1920, 1080, MAX_FPS],               // 1080p
    [1280, 720, MAX_FPS],               // 720p
    [640, 360, MAX_FPS],
    [480, 270, MAX_FPS],
    [320, 240, Math.min(MAX_FPS, 15)], // Apple watch 4:3
    [320, 180, Math.min(MAX_FPS, 15)]  // Apple watch 16:9
];

// Recorded videos are always 720p
const RECORDING_RESOLUTION = [1280, 720];

// Possible FFmpeg commands and options in order to be tried
const FFMPEG_COMMANDS = [
    // ['ffplay', ['-protocol_whitelist', 'rtp,udp,pipe']],
    // ['ffplay', []],
    ['ffmpeg', ['-protocol_whitelist', 'rtp,udp,pipe']],
    ['avconv', ['-protocol_whitelist', 'rtp,udp,pipe']],
    ['ffmpeg', []],
    ['avconv', []]
];
let ffmpegCommand;

module.exports = class SkyBellCameraStream {
    constructor(skybellDevice) {
        this.skybellDevice = skybellDevice;
        this.name = skybellDevice.getDeviceName()
        debugLog("SkyBell stream initated: '" + this.name + "'");

        this.streamResolution = VIDEO_RESOLUTIONS[0];

        this.childProcesses = {};
    }

    // Set the maximum supported resolution
    setResolution(height) {
        if (this.streamResolution[1] != height) {
            let width = { 1080: 1920, 720: 1280, 480: 854 }[height];
            debugLog("setResolution '" + this.name + "': "
                + height + 'x' + width);
            this.streamResolution = [width, height, 30];
        }
    }

    startCall(activity, callback) {
        debugLog("Start Call '" + this.name + "'");

        if (!activity) return this.startLiveCall(callback);
    }

    // Start a live call
    startLiveCall(callback) {
        debugLog("startLiveCall '" + this.name + "'");

        // Start a call to the SkyBell device to obtain the SRTP configuration
        this.skybellDevice.startCall(this.id, (err, call) => {
            if (err) return callback(err);
            // Spawn FFmpeg to transcode the video and audio streams
            this.startStream(call.incomingVideo, call.incomingAudio,
                undefined, undefined, callback);
        });
    }

    // Start an FFmpeg process for a live stream
    startStream(videoIn, microphoneIn, videoOut, microphoneOut, callback) {
        debugLog("startStream '" + this.name + "'");

        // Session Description Protocol (SDP) file for the input streams
        let sdpIn = [
            'v=0',
            'o=- 0 0 IN IP4 127.0.0.1',
            's=' + this.name + ' in',
            't=0 0',

            // Video stream
            'm=video ' + videoIn.port + ' RTP/SAVP ' + videoIn.payloadType,
            'c=IN ' + (ip.isV4Format(videoIn.server) ? 'IP4' : 'IP6')
            + ' ' + videoIn.server,
            'a=rtpmap:' + videoIn.payloadType + ' ' + videoIn.encoding
            + '/' + videoIn.sampleRate,
            'a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:' + videoIn.key,
            'a=ssrc:' + videoIn.ssrc,

            // Microphone audio stream
            // (use L16 as a placeholder; overridden by '-acodec pcm_s16le' arg)
            'm=audio ' + microphoneIn.port + ' RTP/SAVP '
            + microphoneIn.payloadType,
            'c=IN ' + (ip.isV4Format(microphoneIn.server) ? 'IP4' : 'IP6')
            + ' ' + microphoneIn.server,
            'a=rtpmap:' + microphoneIn.payloadType + ' L16/'
            + microphoneIn.sampleRate + '/' + microphoneIn.channels,
            'a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:' + microphoneIn.key,
            'a=ssrc:' + microphoneIn.ssrc
        ];

        // FFmpeg parameters
        let args = [
            '-threads', 0,
            '-loglevel', 'warning',

            // Input streams are (mostly) described by the SDP file
            '-acodec', 'pcm_s16le', // (SDP specifies pcm_s16be)
            '-i', '-',         // (SDP file provided via stdin)

            // Output streams
            ...this.ffmpegOutputArgs(videoOut, microphoneOut,
                this.streamResolution)
        ];

        // Punch through the firewall and then spawn the FFmpeg process
        let firewallPorts = [videoIn.port, microphoneIn.port];
        this.sendPunchPackets(videoIn.server, firewallPorts, (err) => {
            if (err) return callback(err);
            this.spawnFfmpegStream('Stream', args, sdpIn, callback);
        });
    }
    // Common FFmpeg output parameters
    ffmpegOutputArgs(videoOut, microphoneOut, resolutionIn, videoFilters = []) {
        // // Pick the most appropriate output resolution
        // let allowedResolutions = VIDEO_RESOLUTIONS.filter(res => {
        //     return (res[0] <= videoOut.width) && (res[1] <= videoOut.height);
        // });
        // let preferredResolutions = allowedResolutions.filter(res => {
        //     return (resolutionIn[0] <= res[0]) && (resolutionIn[1] <= res[1]);
        // });
        // let resolution = preferredResolutions.pop() || allowedResolutions[0];

        // // Add a video filter to adjust the resolution if necessary
        // let logPrefix = "Resolution for '" + this.name
        //     + "': source (probably) " + resolutionIn[0] + 'x' + resolutionIn[1]
        //     + ', requested ' + videoOut.width + 'x' + videoOut.height + ', ';
        // if (videoFilters.length || (resolution[0] != resolutionIn[0])
        //                         || (resolution[1] != resolutionIn[1])) {
        //     debugLog(logPrefix + 'scaling to ' + resolution[0]
        //                                  + 'x' + resolution[1]);
        //     videoFilters.push('scale=' + resolution[0] + ':' + resolution[1]);
        // } else {
        //     debugLog(logPrefix + 'no scaling applied');
        // }

        // // FFmpeg output parameters
        let args = [];
        if (videoFilters.length) {
            // A video filter is required, so re-encode using specified options
            args.push(
                // Selected video filter(s)
                '-vf', videoFilters.join(','),

                // Video encoding options (always H.264/AVC)
                '-vcodec', 'libx264',
                '-r', videoOut.fps,
                '-tune', 'zerolatency',
                '-profile:v', ['baseline', 'main', 'high'][videoOut.profile],
                '-level:v', ['3.1', '3.2', '4.0'][videoOut.level],
                '-b:v', videoOut.max_bit_rate + 'K',
                '-bufsize', videoOut.max_bit_rate + 'K'
            );
        } else {
            // No video filter required, so just copy the video stream
            args.push(
                '-vcodec', 'copy'
            );
        }
        // args.push (
        //     // Output video stream
        //     '-an',
        //     '-f',                  'rtp',
        //     '-payload_type',       videoOut.pt,
        //     '-srtp_out_suite',     'AES_CM_128_HMAC_SHA1_80',
        //     '-srtp_out_params',    videoOut.key.toString('base64'),
        //     '-ssrc',               this.int32(videoOut.outgoingSsrc),
        //     'srtp://' + videoOut.server + ':' + videoOut.port
        //         + '?rtcpport=' + videoOut.port + '&localrtcpport='
        //         + videoOut.port + '&pkt_size=' + videoOut.mtu
        // );
        // if (microphoneOut.codec == 'OPUS') {
        //     // Audio encoding options for Opus codec
        //     args.push(
        //         '-acodec',         'libopus',
        //         '-vbr',            (microphoneOut.bit_rate == 0) ? 'on' : 'off',
        //         '-frame_duration', microphoneOut.packet_time,
        //         '-application',    'lowdelay'
        //     );
        // } else if (microphoneOut.codec == 'AAC-eld') {
        //     // Audio encoding options for Enhanced Low Delay AAC codec
        //     args.push(
        //         '-acodec',         'libfdk_aac',
        //         '-profile:a',      'aac_eld'
        //     );
        // } else {
        //     debugLog("Unsupported audio codec '"
        //                    + microphoneOut.codec + "'");
        // }
        // args.push(
        //     // Common audio encoding options
        //     '-ac',                 microphoneOut.channel,
        //     '-ar',                 microphoneOut.sample_rate + 'K',
        //     '-b:a',                microphoneOut.max_bit_rate + 'K',

        //     // Output microphone audio stream
        //     '-vn',
        //     '-f',                  'rtp',
        //     '-flags',              '+global_header',
        //     '-payload_type',       microphoneOut.pt,
        //     '-srtp_out_suite',     'AES_CM_128_HMAC_SHA1_80',
        //     '-srtp_out_params',    microphoneOut.key.toString('base64'),
        //     '-ssrc',               this.int32(microphoneOut.outgoingSsrc),
        //     'srtp://' + microphoneOut.server + ':' + microphoneOut.port
        //         + '?rtcpport=' + microphoneOut.port + '&localrtcpport='
        //         + microphoneOut.port
        // );
        args.push(
            // Output video stream
            // '-tune', 'zerolatency',
            // '-b', '900k',
            // '-an',
            // '-f',                  'mpegts',
            // '-payload_type',       videoOut.pt,
            // '-srtp_out_suite',     'AES_CM_128_HMAC_SHA1_80',
            // '-srtp_out_params',    videoOut.key.toString('base64'),
            // '-ssrc',               this.int32(videoOut.outgoingSsrc),
            // 'srtp://' + videoOut.server + ':' + videoOut.port
            // + '?rtcpport=' + videoOut.port + '&localrtcpport='
            // + videoOut.port + '&pkt_size=' + videoOut.mtu
            // 'udp://127.0.0.1:1234'
            './output.mp4'
        );

        // Return the arguments
        return args;
    }

    // Send dummy packets to setup the reverse route through the firewall
    sendPunchPackets(host, ports, callback) {
        if (ports.length == 0) return callback();

        let port = ports.shift();
        debugLog("sendPunchPacket '" + this.name + "': " + host + ':' + port);

        let udp = dgram.createSocket({ type: 'udp4' });
        udp.on('error', err => callback(err));
        udp.bind(port, () => {
            udp.send(Buffer.alloc(8), port, host, err => {
                if (err) return callback(err);
                udp.close(err => {
                    if (err) return callback(err);
                    this.sendPunchPackets(host, ports, callback);
                });
            });
        });
    }

    // Start an FFmpeg process for a stream
    spawnFfmpegStream(type, args, input, callback) {
        let prefix = "FFmpeg '" + this.name + ' (' + type + ")': ";

        // Identify a suitable FFmpeg command
        this.getFfmpegOptions((err, cmd, preArgs) => {
            if (err) return callback(err);

            // Spawn an FFmpeg child process
            let allArgs = [...preArgs, ...args];
            debugLog(prefix + cmd + ' ' + allArgs.join(' '));
            let child = spawn(cmd, allArgs);
            this.childProcesses[type] = child;

            // Provide input to the child process
            input.forEach(line => debugLog(prefix + '< ' + line));
            debugLog(input.join('\n'));
            child.stdin.setEncoding('utf8');
            child.stdin.write(input.join('\n'));
            child.stdin.end();

            // Log output and exit code from the FFmpeg process
            let logOutput = stream => {
                stream.setEncoding('utf8');
                stream.on('data', output => {
                    output.split('\n').forEach(line => {
                        if (line.length) debugLog(prefix + '> ' + line);
                    });
                });
            };
            // debugLog("HELLO WORLD!")
            logOutput(child.stdout);
            logOutput(child.stderr);
            child.on('error', err => {
                debugLog(prefix + 'Child process error: ' + err);
                delete this.childProcesses[type];
            });
            child.on('close', code => {
                if (this.childProcesses[type]) {
                    debugLog(prefix + 'Unexpected exit: ' + code);
                    delete this.childProcesses[type];
                } else {
                    debugLog(prefix + 'Normal exit: ' + code);
                }
            });

            // Assume for now that the child process was spawned successfully
            callback();
        });
    }

    // Attempt to identify a suitable FFmpeg command
    getFfmpegOptions(callback) {
        if (ffmpegCommand) return callback(null, ...ffmpegCommand);
        let testNextCommand = cmds => {
            let cmd = cmds.shift();
            if (!cmd) return callback(Error('No suitable FFmpeg executable'));

            // Try spawning the next command in the list
            let allArgs = [...cmd[1], '-version'];
            debugLog("getFfmpegOptions '" + this.name + "': "
                + cmd[0] + ' ' + allArgs.join(' '));
            let child = spawn(cmd[0], allArgs);

            // Check whether it executes successfully
            child.on('error', err => {
                debugLog("getFfmpegOptions '" + this.name
                    + "': Failed with error: " + err);
                testNextCommand(cmds);
                child = null;
            });
            child.on('close', code => {
                if (!child) return;
                if (code) {
                    debugLog("getFfmpegOptions '" + this.name
                        + "': Failed with code " + code);
                    testNextCommand(cmds);
                } else {
                    debugLog("getFfmpegOptions '" + this.name
                        + "': Success");
                    ffmpegCommand = cmd;
                    callback(null, ...ffmpegCommand);
                }
            });
        }
        testNextCommand(FFMPEG_COMMANDS);
    }

    // Convert integer to signed 32-bit (required for FFmpeg output SSRC values)
    int32(value) {
        return ~~value;
    }
}