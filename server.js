const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// 🔥 Modules Import
const notificationEngine = require('./services/notificationEngine.js');
const Record = require('./models/Record');
const whatsappRoutes = require('./routes/whatsappRoutes.js');
// 🔥 Exposed sendAutoWaMessage & sendVerificationMedia
const { connectToWhatsApp, getWhatsAppStatus, resetWhatsApp, getProfilePicUrl, sendAutoWaMessage, sendVerificationMedia } = require('./services/whatsappService.js');
const authenticateToken = require('./middleware/auth.js');
const { sendEmailViaService } = require('./services/emailService.js');

const app = express();
app.use(cors()); 
app.use(express.json());

// Initialize Notifications, Cron Jobs and WhatsApp Engine
notificationEngine.initFirebase();
notificationEngine.startCronJobs();
connectToWhatsApp();

// ==========================================
// MONGODB CONNECTION
// ==========================================
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Securely Connected to MongoDB Atlas'))
    .catch((err) => console.error('❌ MongoDB Connection Error:', err));
const JWT_SECRET = process.env.JWT_SECRET || 'VerifyHub_Elite_Security_Key_2026';
const otpStorage = new Map();
// ==========================================
// ELITE SANITIZER
// ==========================================
const sanitizeRecord = (doc) => {
    const raw = doc.toObject ? doc.toObject() : doc;
    return {
        id: String(raw.id || (raw._id ? raw._id.toString() : "")),
        transactionType: String(raw.transactionType || ""),
        primaryType: String(raw.primaryType || ""),
        phoneNumber: String(raw.phoneNumber || ""),
        customerName: String(raw.customerName || ""),
        date: String(raw.date || ""),
        activationDate: String(raw.activationDate || ""),
        verificationDueDate: String(raw.verificationDueDate || ""),
    
        status: String(raw.status || "Pending"),
        planValue: String(raw.planValue || ""),
        billDate: String(raw.billDate || ""),
        lastCallReason: String(raw.lastCallReason || ""),
        remarks: String(raw.remarks || ""),
        secondaryData: String(raw.secondaryData || "[]"), 
        upcCode: String(raw.upcCode || ""),
        gender: String(raw.gender || ""),
        paidMonths: String(raw.paidMonths || ""),
    
        groupId: String(raw.groupId || "")
    };
};
// ==========================================
// AUTH ROUTES
// ==========================================
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASS) {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpStorage.set(username, { otp: otp, expiresAt: Date.now() + 5 * 60 * 1000 });

        const emailResult = await sendEmailViaService({
            to: process.env.ADMIN_EMAIL,
         
            subject: "VerifyHub Security - Login Access OTP",
            type: "otp",
            otp: otp
        });

        if (emailResult.success) {
            res.status(200).json({ success: true, message: "OTP successfully sent." });
        } else {
            res.status(500).json({ success: false, message: `Server Error: ${emailResult.error}` });
        }
    } else {
        res.status(401).json({ success: false, message: "Invalid credentials." });
}
});

app.post('/api/auth/verify-otp', (req, res) => {
    const { username, otp } = req.body;
    const storedData = otpStorage.get(username);
    if (!storedData) return res.status(400).json({ success: false, message: "No active OTP session found." });
    if (Date.now() > storedData.expiresAt) return res.status(400).json({ success: false, message: "OTP has expired." });

    if (storedData.otp === otp) {
        otpStorage.delete(username); 
        const token = jwt.sign({ username: username, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
        
        res.status(200).json({ success: true, message: "Access Granted.", token: token });
    } else {
        res.status(401).json({ success: false, message: "Invalid OTP." });
    }
});
// ==========================================
// GENERIC EMAIL DISPATCH ROUTE
// ==========================================
app.post('/api/email/send', authenticateToken, async (req, res) => {
    const { to, subject, html, text, type, otp } = req.body;
    if (!to || !subject) {
        return res.status(400).json({ success: false, message: "Missing required parameters: to and subject." });
    }

    const result = await sendEmailViaService({ to, subject, html, text, type, otp });
    if (result.success) {
        res.status(200).json({ success: true, message: "Email transmitted successfully.", details: result.data });
    } 
    else {
        res.status(500).json({ success: false, message: "Email relay failed.", error: result.error });
    }
});
// ==========================================
// REST API ROUTES
// ==========================================
app.get('/api/records', authenticateToken, async (req, res) => {
    try {
        const records = await Record.find().sort({ createdAt: -1 });
        res.status(200).json(records.map(sanitizeRecord));
    } catch (error) { res.status(500).json({ message: "Server Error", error: error.message }); }
});
app.post('/api/records', authenticateToken, async (req, res) => {
    try {
        const newRecord = new Record(req.body);
        const savedRecord = await newRecord.save();
        notificationEngine.notifyNewRecord(savedRecord);
        res.status(201).json(sanitizeRecord(savedRecord));
    } catch (error) {
        if (error.code === 11000) return res.status(400).json({ message: "Record already exists." });
        res.status(500).json({ message: "Server Error", error: error.message });
    }
});
app.put('/api/records/:id', authenticateToken, async (req, res) => {
    try {
        const oldRecord = await Record.findOne({ id: req.params.id });
        const updatedRecord = await Record.findOneAndUpdate({ id: req.params.id }, req.body, { new: true, runValidators: true });
        if (!updatedRecord) return res.status(404).json({ message: "Record not found" });
        if (oldRecord) {
            notificationEngine.notifyRecordUpdate(oldRecord, updatedRecord);
        }
     
        res.status(200).json(sanitizeRecord(updatedRecord));
    } catch (error) { res.status(500).json({ message: "Server Error", error: error.message }); }
});
app.delete('/api/records/:id', authenticateToken, async (req, res) => {
    try {
        const deletedRecord = await Record.findOneAndDelete({ id: req.params.id });
        if (!deletedRecord) return res.status(404).json({ message: "Record not found" });
        res.status(200).json({ message: "Record deleted successfully" });
    } catch (error) { res.status(500).json({ message: "Server Error", error: error.message }); }
});
// ==========================================
// DASHBOARD & WHATSAPP ROUTES
// ==========================================
app.use('/api/whatsapp', whatsappRoutes);

app.get('/api/dashboard/status', (req, res) => {
    res.status(200).json(getWhatsAppStatus());
});
app.post('/api/whatsapp/reset', authenticateToken, async (req, res) => {
    await resetWhatsApp();
    res.status(200).json({ success: true, message: "Engine Reset Triggered" });
});
app.get('/api/whatsapp/get-dp/:phone', authenticateToken, async (req, res) => {
    try {
        const phone = req.params.phone;
        const forceRefresh = req.query.force === 'true';

        if (!phone) return res.status(400).json({ success: false, url: null });

        const url = await getProfilePicUrl(phone, forceRefresh);
        if (url) {
            res.status(200).json({ success: true, url: url });
        } 
        else {
            res.status(200).json({ success: false, url: null });
        }
    } catch (error) {
        console.error("DP Fetch Server Route Error:", error);
        res.status(500).json({ success: false, url: null });
    }
});

// 🔥 SMART FIX: Route to Send Messages
app.post('/api/whatsapp/send/:phone', authenticateToken, async (req, res) => {
    try {
        const phone = req.params.phone;
        const { text } = req.body;

        if (!phone || !text) {
            return res.status(400).json({ success: false, message: "Invalid payload" });
        }

        const isSent = await sendAutoWaMessage(phone, text);
      
        if (isSent) {
            res.status(200).json({ success: true, message: "Sent successfully via Cloud WA" });
        } else {
            res.status(500).json({ success: false, message: "Cloud WA is offline or not connected" });
        }
    } catch (error) {
        console.error("WA Send Error:", error);
        res.status(500).json({ success: false, message: "Server Error" });
  
    }
});

// 🔥 SMART FIX: Route to Transmit Media
app.post('/api/whatsapp/send-media/:phone', authenticateToken, async (req, res) => {
    try {
        const phone = req.params.phone;
        const { type } = req.body; 

        if (!phone || !type) {
            return res.status(400).json({ success: false, message: "Invalid payload" });
        }

        const result = await sendVerificationMedia(phone, type);
        if (result.success) {
            res.status(200).json(result);
        } else {
            res.status(500).json(result);
        }
    } catch (error) {
        console.error("WA Media Send Error:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// ==========================================
// FRONTEND STATUS PAGE
// ==========================================
app.get('/', (req, res) => {
    res.send("<h1>VerifyHub API</h1><p>Services Chalu Hai 🚀</p>");
});
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 VerifyHub Backend Running on Port: ${PORT}`);
});
