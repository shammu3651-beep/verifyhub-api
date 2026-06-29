const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// 🔥 Modules Import
const notificationEngine = require('./services/notificationEngine.js');
const Record = require('./models/Record');
const whatsappRoutes = require('./routes/whatsappRoutes.js');
const { connectToWhatsApp } = require('./services/whatsappService.js');
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
// AUTH ROUTES (For App Internal Use)
// ==========================================
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASS) {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpStorage.set(username, { otp: otp, expiresAt: Date.now() + 5 * 60 * 1000 });

        // Using centralized email service interface for safe OTP transport
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

    // Trigger internal centralized service component mapping
    const result = await sendEmailViaService({ to, subject, html, text, type, otp });
    if (result.success) {
        res.status(200).json({ success: true, message: "Email transmitted successfully.", details: result.data });
    } else {
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
        
        // 🔥 Trigger dynamic new record alert
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

        // 🔥 Trigger smart update alert
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

// 🔥 WhatsApp API Routes Mounted
app.use('/api/whatsapp', whatsappRoutes);

// ==========================================
// FRONTEND STATUS PAGE (Clean UI)
// ==========================================
app.get('/', (req, res) => {
    const statusPageHTML = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>VerifyHub - System Status</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800;900&display=swap');
            body { margin: 0; padding: 0; font-family: 'Inter', sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; overflow: hidden; }
            .glass-container { text-align: center; background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(10px); padding: 50px 40px; border-radius: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.4); border: 1px solid rgba(255, 255, 255, 0.1); max-width: 400px; width: 100%; box-sizing: border-box; }
            .logo-placeholder { width: 60px; height: 60px; background: linear-gradient(135deg, #3b82f6, #4f46e5); border-radius: 16px; display: inline-flex; justify-content: center; align-items: center; margin-bottom: 20px; font-size: 28px; font-weight: 900; color: white; box-shadow: 0 10px 20px rgba(79, 70, 229, 0.3); }
            h1 { margin: 0 0 10px; font-size: 2rem; font-weight: 800; color: #e2e8f0; }
            p { color: #94a3b8; font-size: 1rem; margin-bottom: 30px; font-weight: 600; }
            .status-badge { display: inline-flex; align-items: center; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); padding: 10px 20px; border-radius: 50px; color: #10b981; font-weight: 800; }
            .pulse { width: 10px; height: 10px; background: #10b981; border-radius: 50%; margin-right: 12px; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); animation: pulse 2s infinite; }
            @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); } 70% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); } 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); } }
            .system-info { margin-top: 30px; font-size: 0.8rem; color: #64748b; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 20px; font-weight: 600; }
        </style>
    </head>
    <body>
        <div class="glass-container">
            <div class="logo-placeholder">V</div>
            <h1>VerifyHub API</h1>
            <p>Secure routing and backend services are operational.</p>
            <div class="status-badge">
                <div class="pulse"></div>
                Services Chalu Hai 🚀
            </div>
            <div class="system-info">
                System: Online | Environment: Production
            </div>
        </div>
    </body>
    </html>
    `;
    res.send(statusPageHTML);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 VerifyHub Backend Running on Port: ${PORT}`);
});
