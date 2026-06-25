const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
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
// SYSTEM SECURITY CONSTANTS
// ==========================================
const JWT_SECRET = process.env.JWT_SECRET || 'VerifyHub_Elite_Security_Key_2026';
const otpStorage = new Map();

// ==========================================
// ZERO-TRUST MIDDLEWARE (Data Protector)
// ==========================================
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Extracts "Bearer <token>"
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'Access Denied: Missing Security Token!' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Token Corrupted or Expired! Forced Logout.' });
        }
        req.user = user;
        next();
    });
};

// ==========================================
// 1. SECURE SERVER-SIDE LOGIN ROUTE (Trigger OTP)
// ==========================================
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASS) {
        
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        otpStorage.set(username, {
            otp: otp,
            expiresAt: Date.now() + 5 * 60 * 1000 
        });

        try {
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
// 2. VERIFY OTP ROUTE (Generate JWT)
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
        otpStorage.delete(username); 
        
        // Elite Security: Generate Encrypted JWT valid for 7 Days
        const token = jwt.sign({ username: username, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
        
        res.status(200).json({ 
            success: true, 
            message: "Authentication complete. Access Granted.",
            token: token // Sending token to Android App
        });
    } else {
        res.status(401).json({ success: false, message: "Invalid OTP. Access Denied." });
    }
});

app.post('/api/test-email', authenticateToken, async (req, res) => {
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
// PROTECTED REST API ROUTES (Requires JWT)
// ==========================================

app.get('/api/records', authenticateToken, async (req, res) => {
    try {
        const records = await Record.find().sort({ createdAt: -1 });
        res.status(200).json(records);
    } catch (error) {
        res.status(500).json({ message: "Server Error: Unable to fetch records", error: error.message });
    }
});

app.post('/api/records', authenticateToken, async (req, res) => {
    try {
        const newRecord = new Record(req.body);
        const savedRecord = await newRecord.save();
        res.status(201).json(savedRecord);
    } catch (error) {
        if (error.code === 11000) return res.status(400).json({ message: "Record with this ID already exists." });
        res.status(500).json({ message: "Server Error: Unable to save record", error: error.message });
    }
});

app.put('/api/records/:id', authenticateToken, async (req, res) => {
    try {
        const updatedRecord = await Record.findOneAndUpdate({ id: req.params.id }, req.body, { new: true, runValidators: true });
        if (!updatedRecord) return res.status(404).json({ message: "Record not found" });
        res.status(200).json(updatedRecord);
    } catch (error) {
        res.status(500).json({ message: "Server Error: Unable to update record", error: error.message });
    }
});

app.delete('/api/records/:id', authenticateToken, async (req, res) => {
    try {
        const deletedRecord = await Record.findOneAndDelete({ id: req.params.id });
        if (!deletedRecord) return res.status(404).json({ message: "Record not found" });
        res.status(200).json({ message: "Record deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server Error: Unable to delete record", error: error.message });
    }
});

// ==========================================
// FRONTEND STATUS PAGE (Root Route)
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
            body { margin: 0; padding: 0; font-family: 'Inter', sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; overflow: hidden; }
            .glass-container { text-align: center; background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(10px); padding: 50px 40px; border-radius: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.4); border: 1px solid rgba(255, 255, 255, 0.1); max-width: 400px; width: 100%; }
            .logo-placeholder { width: 60px; height: 60px; background: linear-gradient(135deg, #3b82f6, #4f46e5); border-radius: 16px; display: inline-flex; justify-content: center; align-items: center; margin-bottom: 20px; font-size: 28px; font-weight: 900; color: white; box-shadow: 0 10px 20px rgba(79, 70, 229, 0.3); }
            h1 { margin: 0 0 10px; font-size: 2rem; font-weight: 800; color: #e2e8f0; }
            p { color: #94a3b8; font-size: 1rem; margin-bottom: 30px; }
            .status-badge { display: inline-flex; align-items: center; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); padding: 10px 20px; border-radius: 50px; color: #10b981; font-weight: 700; }
            .pulse { width: 10px; height: 10px; background: #10b981; border-radius: 50%; margin-right: 12px; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); animation: pulse 2s infinite; }
            @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); } 70% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); } 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); } }
            .system-info { margin-top: 30px; font-size: 0.8rem; color: #64748b; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 20px; }
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
