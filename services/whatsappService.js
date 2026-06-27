const { default: makeWASocket, DisconnectReason, Browsers, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const BaileysAuth = require('../models/BaileysAuth');

let sock;
let currentQRBase64 = null;
let isConnected = false;

// Smart MongoDB Auth Adapter for Baileys
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

        // Reverted to macOS Desktop to avoid aggressive Render IP blocking
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: true, 
            logger: pino({ level: 'silent' }), // Keep it silent to avoid log bloat on Render
            browser: Browsers.macOS('Desktop'),
            syncFullHistory: false,
            generateHighQualityLinkPreview: false,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 25000, // Slightly higher interval to stay stable
            markOnlineOnConnect: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('🔄 New WhatsApp QR String Received from WhatsApp Servers!');
                try {
                    currentQRBase64 = await QRCode.toDataURL(qr); 
                    console.log('✅ QR Code Base64 Encoded for Android App');
                } catch (qrErr) {
                    console.error('❌ Failed to encode QR:', qrErr);
                }
            }

            if (connection === 'close') {
                isConnected = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(`⚠️ WhatsApp Connection Closed. Code: ${statusCode}`);
                
                // Only wipe DB on exact logout. Ignore rate limits (405) for session wiping.
                if (statusCode === DisconnectReason.loggedOut) {
                    console.log('🚫 WhatsApp Logged Out! Wiping Session Data from MongoDB...');
                    await BaileysAuth.deleteMany({});
                    currentQRBase64 = null;
                    setTimeout(connectToWhatsApp, 5000);
                } else {
                    // For Code 405 or temporary drops, DO NOT wipe DB. Just reconnect.
                    console.log('🔄 Temporary Drop. Attempting Reconnect in 5 seconds...');
                    setTimeout(connectToWhatsApp, 5000);
                }
            } else if (connection === 'open') {
                console.log('✅ WhatsApp Web Successfully Connected!');
                isConnected = true;
                currentQRBase64 = null;
            }
        });

    } catch (error) {
        console.error('❌ CRITICAL ERROR in WhatsApp Engine:', error);
    }
};

const getWhatsAppStatus = () => {
    return {
        isConnected,
        qrCode: isConnected ? null : currentQRBase64
    };
};

module.exports = { connectToWhatsApp, getWhatsAppStatus };
