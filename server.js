const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const Record = require('./models/Record');

const app = express();

app.use(cors()); 
app.use(express.json());

// ==========================================
// MONGODB CONNECTION
// ==========================================
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Securely Connected to MongoDB Atlas'))
    .catch((err) => console.error('❌ MongoDB Connection Error:', err));


// ==========================================
// SECURE OTP STORAGE (In-Memory)
// ==========================================
// Holds OTP records for 5 minutes: { "samshaad365": { otp: "123456", expiresAt: 1718000000 } }
const otpStorage = new Map();

// ==========================================
// 1. SECURE SERVER-SIDE LOGIN ROUTE (Trigger OTP)
// ==========================================
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASS) {
        
        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Store in memory with 5-minute expiry
        otpStorage.set(username, {
            otp: otp,
            expiresAt: Date.now() + 5 * 60 * 1000 
        });

        try {
            // Backend internally calls Vercel Proxy to hide API Keys from Android App
            const vercelRes = await fetch('https://email-testtt.vercel.app/api/send-email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.VERCEL_EMAIL_API_KEY}`
                },
                body: JSON.stringify({
                    to: process.env.ADMIN_EMAIL,
                    subject: "VerifyHub Security - Login Access OTP",
                    type: "otp",
                    otp: otp
                })
            });

            if (vercelRes.ok) {
                res.status(200).json({ success: true, message: `OTP successfully sent to admin email.` });
            } else {
                res.status(500).json({ success: false, message: "Server Error: Failed to dispatch OTP from mail gateway." });
            }
        } catch (error) {
            console.error("Vercel Fetch Error:", error);
            res.status(500).json({ success: false, message: "Network Error: Mail gateway unreachable." });
        }
    } else {
        res.status(401).json({ success: false, message: "Invalid credentials. Access denied." });
    }
});

// ==========================================
// 2. VERIFY OTP ROUTE
// ==========================================
app.post('/api/auth/verify-otp', (req, res) => {
    const { username, otp } = req.body;
    const storedData = otpStorage.get(username);

    if (!storedData) {
        return res.status(400).json({ success: false, message: "No active OTP session found. Please login again." });
    }

    if (Date.now() > storedData.expiresAt) {
        otpStorage.delete(username);
        return res.status(400).json({ success: false, message: "OTP has expired. Please request a new one." });
    }

    if (storedData.otp === otp) {
        otpStorage.delete(username); // Clear after successful login
        res.status(200).json({ success: true, message: "Authentication complete. Access Granted." });
    } else {
        res.status(401).json({ success: false, message: "Invalid OTP. Access Denied." });
    }
});

// ==========================================
// 3. SYSTEM TEST EMAIL ROUTE (For App Settings)
// ==========================================
app.post('/api/test-email', async (req, res) => {
    const { to, otp } = req.body;
    try {
        const vercelRes = await fetch('https://email-testtt.vercel.app/api/send-email', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.VERCEL_EMAIL_API_KEY}`
            },
            body: JSON.stringify({
                to: to,
                subject: "VerifyHub Security - System Test",
                type: "otp",
                otp: otp
            })
        });

        if (vercelRes.ok) {
            res.status(200).json({ success: true, message: "Test OTP delivered successfully." });
        } else {
            res.status(500).json({ success: false, message: "Failed: Vercel node rejected request." });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "Network Exception: Email drop failed." });
    }
});


// ==========================================
// REST API ROUTES FOR VERIFYHUB RECORDS
// ==========================================

app.get('/api/records', async (req, res) => {
    try {
        const records = await Record.find().sort({ createdAt: -1 });
        res.status(200).json(records);
    } catch (error) {
        res.status(500).json({ message: "Server Error: Unable to fetch records", error: error.message });
    }
});

app.post('/api/records', async (req, res) => {
    try {
        const newRecord = new Record(req.body);
        const savedRecord = await newRecord.save();
        res.status(201).json(savedRecord);
    } catch (error) {
        if (error.code === 11000) return res.status(400).json({ message: "Record with this ID already exists." });
        res.status(500).json({ message: "Server Error: Unable to save record", error: error.message });
    }
});

app.put('/api/records/:id', async (req, res) => {
    try {
        const updatedRecord = await Record.findOneAndUpdate({ id: req.params.id }, req.body, { new: true, runValidators: true });
        if (!updatedRecord) return res.status(404).json({ message: "Record not found" });
        res.status(200).json(updatedRecord);
    } catch (error) {
        res.status(500).json({ message: "Server Error: Unable to update record", error: error.message });
    }
});

app.delete('/api/records/:id', async (req, res) => {
    try {
        const deletedRecord = await Record.findOneAndDelete({ id: req.params.id });
        if (!deletedRecord) return res.status(404).json({ message: "Record not found" });
        res.status(200).json({ message: "Record deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server Error: Unable to delete record", error: error.message });
    }
});

// Status Page
app.get('/', (req, res) => {
    res.send('<h1>VerifyHub API</h1><p>Secure routing and backend services are operational.</p>');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 VerifyHub Backend Running on Port: ${PORT}`);
});
