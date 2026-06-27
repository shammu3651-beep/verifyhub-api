const { makeWASocket, DisconnectReason, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const BaileysAuth = require('../models/BaileysAuth');

let sock;
let currentQRBase64 = null;
let isConnected = false;

// 🔥 Smart MongoDB Auth Adapter for Baileys
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
                                // Update or Insert new keys
                                await BaileysAuth.updateOne(
                                    { _id: key }, 
                                    { data: JSON.stringify(value, BufferJSON.replacer) }, 
                                    { upsert: true }
                                );
                            } else {
                                // 🔥 Smart Clean: Remove trash keys when they are no longer needed
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
    const { state, saveCreds } = await useMongoDBAuthState();

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // Server logs me bhi QR dikhega
        logger: pino({ level: 'silent' }), // Faltu logs hide karne ke liye
        browser: ['VerifyHub', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('🔄 New WhatsApp QR Generated');
            currentQRBase64 = await QRCode.toDataURL(qr); // Convert to base64 for Android App
        }

        if (connection === 'close') {
            isConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('⚠️ WhatsApp Connection Closed. Reconnecting...');
                connectToWhatsApp();
            } else {
                console.log('🚫 WhatsApp Logged Out! Wiping Session Data from MongoDB...');
                // 🔥 SMART CLEANING: Poora session kachra MongoDB se saaf
                await BaileysAuth.deleteMany({});
                currentQRBase64 = null;
                connectToWhatsApp(); // Naya QR generate karne ke liye restart
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Web Successfully Connected!');
            isConnected = true;
            currentQRBase64 = null;
        }
    });
};

const getWhatsAppStatus = () => {
    return {
        isConnected,
        qrCode: isConnected ? null : currentQRBase64
    };
};

module.exports = { connectToWhatsApp, getWhatsAppStatus };
