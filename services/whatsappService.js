// ===============================
// FILE: services/whatsappService.js
// ===============================
const { default: makeWASocket, DisconnectReason, initAuthCreds, BufferJSON, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal'); 
const BaileysAuth = require('../models/BaileysAuth');

let sock;
let currentQRBase64 = null;
let isConnected = false;

// 24 Hour LRU Cache for DPs
const backendDpCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;

const useMongoDBAuthState = async () => {
    let credsDoc = await BaileysAuth.findById('creds');
    let creds = credsDoc ? JSON.parse(credsDoc.data, BufferJSON.reviver) : initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    for (let id of ids) {
                        let doc = await BaileysAuth.findById(`${type}-${id}`);
                        if (doc) data[id] = JSON.parse(doc.data, BufferJSON.reviver);
                    }
                    return data;
                },
                set: async (data) => {
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                await BaileysAuth.updateOne(
                                    { _id: key }, 
                                    { data: JSON.stringify(value, BufferJSON.replacer) }, 
                                    { upsert: true }
                                );
                            } else {
                                await BaileysAuth.deleteOne({ _id: key });
                            }
                        }
                    }
                }
            }
        },
        saveCreds: async () => {
            await BaileysAuth.updateOne(
                { _id: 'creds' }, 
                { data: JSON.stringify(creds, BufferJSON.replacer) }, 
                { upsert: true }
            );
        }
    };
};

const connectToWhatsApp = async () => {
    try {
        console.log('⏳ Initializing WhatsApp Engine...');
        const { state, saveCreds } = await useMongoDBAuthState();
        console.log('✅ MongoDB Auth State Loaded Successfully');
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`🚀 Starting Cloud WA Engine (v${version.join('.')}) - Session backed by MongoDB!`);
        
        sock = makeWASocket({
            version, 
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
            },
            logger: pino({ level: 'silent' }), 
            browser: ["VerifyHub Admin", "Chrome", "1.0.0"], 
            syncFullHistory: false,
            generateHighQualityLinkPreview: false,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 25000,
            markOnlineOnConnect: false
        });
        
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('\n=================================================');
                console.log('📱 SCAN THIS QR CODE WITH YOUR WHATSAPP');
                console.log('=================================================\n');
                qrcodeTerminal.generate(qr, { small: true });
                console.log('\n(Waiting for scan...)\n');
                try {
                    currentQRBase64 = await QRCode.toDataURL(qr); 
                    console.log('✅ QR Code Base64 Encoded for Web Dashboard');
                } catch (qrErr) {
                    console.error('❌ Failed to encode QR:', qrErr);
                }
            }

            if (connection === 'close') {
                isConnected = false;
                currentQRBase64 = null;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log(`❌ WhatsApp Connection Closed. Status Code: ${statusCode}. Reconnecting: ${shouldReconnect}`);
                
                if (shouldReconnect) {
                    console.log('🔄 Temporary Drop. Attempting Reconnect in 3 seconds...');
                    setTimeout(connectToWhatsApp, 3000);
                } else {
                    console.log('🚫 Logged out. Automatically wiping DB session data...');
                    try {
                        await BaileysAuth.deleteMany({});
                        console.log('✅ Old DB session wiped successfully. Generating fresh QR code...');
                    } catch (err) {
                        console.error('⚠️ Could not wipe DB auth data:', err.message);
                    }
                    setTimeout(connectToWhatsApp, 3000);
                }
            } else if (connection === 'open') {
                console.log('\n✅ ===========================================');
                console.log('✅ WhatsApp Web Successfully Connected!');
                console.log('✅ ===========================================\n');
                isConnected = true;
                currentQRBase64 = null;
            }
        });

    } catch (error) {
        console.error('❌ CRITICAL ERROR in WhatsApp Engine:', error);
        setTimeout(connectToWhatsApp, 5000); 
    }
};

const getWhatsAppStatus = () => {
    return {
        isConnected,
        qrCode: isConnected ? null : currentQRBase64
    };
};

const resetWhatsApp = async () => {
    console.log('🧹 FORCED RESET: Wiping MongoDB Session & Restarting Engine...');
    await BaileysAuth.deleteMany({});
    currentQRBase64 = null;
    isConnected = false;
    try {
        if (sock) {
            sock.ev.removeAllListeners();
            sock.ws.close(); 
        }
    } catch (e) {
        console.log('Socket cleanup minor warning ignored.');
    }
    setTimeout(connectToWhatsApp, 3000); 
};

async function getProfilePicUrl(phone, forceRefresh = false) {
    if (!sock) return null;
    try {
        let jid = '';
        let cacheKey = '';
        
        if (phone === 'me' || phone === 'admin') {
            if (!sock.user || !sock.user.id) return null;
            jid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            cacheKey = 'me';
        } else {
            let clean = String(phone).replace(/\D/g, '');
            if (clean.length === 10) clean = '91' + clean;
            jid = `${clean}@s.whatsapp.net`;
            cacheKey = clean;
        }
        
        if (!forceRefresh && backendDpCache.has(cacheKey)) {
            const cached = backendDpCache.get(cacheKey);
            if (Date.now() - cached.timestamp < CACHE_TTL) {
                if (cached.url) return cached.url;
            }
        }

        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000));
        const fetchPic = sock.profilePictureUrl(jid, 'image'); 
        
        const url = await Promise.race([fetchPic, timeout]);
        if (url) {
            backendDpCache.set(cacheKey, { url: url, timestamp: Date.now() });
            return url;
        }
        return null;
    } catch (err) {
        console.error(`❌ DP Fetch Error for ${phone}:`, err.message);
        let cacheKey = (phone === 'me' || phone === 'admin') ? 'me' : String(phone).replace(/\D/g, '');
        backendDpCache.delete(cacheKey);
        return null;
    }
}

// 🔥 SMART WA MSG ENGINE
async function sendAutoWaMessage(phone, text) {
    if (!sock || !isConnected) {
        return false;
    }
    try {
        let clean = String(phone).replace(/\D/g, '');
        if (clean.length === 10) clean = '91' + clean;
        const jid = `${clean}@s.whatsapp.net`;
        
        await sock.sendMessage(jid, { text: text });
        return true;
    } catch (err) {
        console.error("❌ Send Error:", err.message);
        return false;
    }
}

// 🔥 SMART WA MEDIA ENGINE - Serves files directly from local storage
async function sendLocalMedia(phone, filePath, caption = "") {
    if (!sock || !isConnected) {
        return false;
    }
    try {
        let clean = String(phone).replace(/\D/g, '');
        if (clean.length === 10) clean = '91' + clean;
        const jid = `${clean}@s.whatsapp.net`;
        
        await sock.sendMessage(jid, { 
            image: { url: filePath }, 
            caption: caption 
        });
        return true;
    } catch (err) {
        console.error("❌ Media Send Error:", err.message);
        return false;
    }
}

// Ensure modules are exported
module.exports = { connectToWhatsApp, getWhatsAppStatus, resetWhatsApp, getProfilePicUrl, sendAutoWaMessage, sendLocalMedia };
