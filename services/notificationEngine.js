const admin = require('firebase-admin');
const cron = require('node-cron');
const Record = require('../models/Record');

const initFirebase = () => {
    try {
        if (admin.apps.length > 0) return;
        let serviceAccount;
        if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
            const decodedString = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8');
            serviceAccount = JSON.parse(decodedString);
            console.log('✅ Notification Engine: Connected via ENV (Production)');
        } else {
            serviceAccount = require('../serviceAccountKey.json');
            console.log('✅ Notification Engine: Connected via Local JSON (Dev)');
        }
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch (error) { console.error('❌ Notification Engine Init Error:', error.message); }
};

const sendPush = async (title, body) => {
    try {
        await admin.messaging().send({ notification: { title, body }, topic: 'admin_alerts' });
        console.log(`📤 Push Dispatched: ${title}`);
    } catch (error) { console.error('❌ Push Failed:', error.message); }
};

const startCronJobs = () => {
    cron.schedule('0 10 * * *', async () => {
        console.log('⏰ Running 10:00 AM Smart Notification Check...');
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        try {
            const records = await Record.find({ status: { $regex: new RegExp("^pending$", "i") } });
            let verificationCount = 0, activationCount = 0, mnpCount = 0;
            records.forEach(record => {
                if (record.verificationDueDate && record.verificationDueDate.startsWith(today)) verificationCount++;
                if (record.activationDate && record.activationDate.startsWith(today)) {
                    activationCount++;
                    const type = String(record.transactionType || "").toUpperCase();
                    if (type.includes('MNP') || type.includes('PORT')) mnpCount++;
                }
            });
            if (verificationCount > 0) sendPush("Verifications Due 📋", `Aaj ${verificationCount} new entry/entries ka verification pending hai.`);
            if (activationCount > 0) sendPush("Activations Today ⚡", `Aaj total ${activationCount} connections activate hone hain. Jisme se ${mnpCount} MNP targets hain 🚀`);
        } catch (error) { console.error('❌ Cron Engine Error:', error); }
    }, { scheduled: true, timezone: "Asia/Kolkata" });
};

const notifyNewRecord = (record) => {
    const type = String(record.transactionType || "").toUpperCase();
    const name = record.customerName || "Customer";
    if (type.includes('MNP') || type.includes('PORT')) sendPush("New MNP Request 🔄", `${name} ka naya MNP request log ho gaya hai.`);
    else sendPush("New Entry Saved ✨", `${name} (${record.transactionType}) ki detail save ho gayi hai.`);
};

const notifyRecordUpdate = (oldRecord, newRecord) => {
    const name = newRecord.customerName || "Customer";
    const type = String(newRecord.transactionType || "").toUpperCase();
    const oldStatus = String(oldRecord.status || "").toLowerCase();
    const newStatus = String(newRecord.status || "").toLowerCase();

    if (oldStatus !== 'active' && newStatus === 'active') {
        if (type.includes('MNP') || type.includes('PORT')) sendPush("MNP Activated 🎉", `${name} ka ported number active ho gaya hai!`);
        else sendPush("Connection Live 🟢", `${name} ka naya connection ab active hai.`);
    }
    if (oldStatus !== 'verified' && newStatus === 'verified') sendPush("Verification Complete ✅", `${name} ki tele-verification done.`);
};

module.exports = { initFirebase, startCronJobs, sendPush, notifyNewRecord, notifyRecordUpdate };
