const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const Record = require('./models/Record');

const app = express();

// Middleware
app.use(cors()); 
app.use(express.json()); 

// ==========================================
// MONGODB CONNECTION
// ==========================================
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Securely Connected to MongoDB Atlas'))
    .catch((err) => console.error('❌ MongoDB Connection Error:', err));

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
            body {
                margin: 0;
                padding: 0;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
                color: #f8fafc;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                overflow: hidden;
            }
            .glass-container {
                text-align: center;
                background: rgba(30, 41, 59, 0.7);
                backdrop-filter: blur(10px);
                padding: 50px 40px;
                border-radius: 24px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.4);
                border: 1px solid rgba(255, 255, 255, 0.1);
                max-width: 400px;
                width: 100%;
            }
            .logo-placeholder {
                width: 60px;
                height: 60px;
                background: linear-gradient(135deg, #3b82f6, #4f46e5);
                border-radius: 16px;
                display: inline-flex;
                justify-content: center;
                align-items: center;
                margin-bottom: 20px;
                font-size: 28px;
                font-weight: 900;
                color: white;
                box-shadow: 0 10px 20px rgba(79, 70, 229, 0.3);
            }
            h1 {
                margin: 0 0 10px;
                font-size: 2rem;
                font-weight: 800;
                color: #e2e8f0;
                letter-spacing: -0.5px;
            }
            p {
                color: #94a3b8;
                font-size: 1rem;
                margin-bottom: 30px;
                line-height: 1.5;
            }
            .status-badge {
                display: inline-flex;
                align-items: center;
                background: rgba(16, 185, 129, 0.1);
                border: 1px solid rgba(16, 185, 129, 0.3);
                padding: 10px 20px;
                border-radius: 50px;
                color: #10b981;
                font-weight: 700;
                font-size: 0.95rem;
                letter-spacing: 0.5px;
            }
            .pulse {
                width: 10px;
                height: 10px;
                background: #10b981;
                border-radius: 50%;
                margin-right: 12px;
                box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
                animation: pulse 2s infinite;
            }
            @keyframes pulse {
                0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
                70% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
                100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
            }
            .system-info {
                margin-top: 30px;
                font-size: 0.8rem;
                color: #64748b;
                border-top: 1px solid rgba(255,255,255,0.05);
                padding-top: 20px;
            }
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


// ==========================================
// REST API ROUTES FOR VERIFYHUB
// ==========================================

// 1. GET ALL RECORDS
app.get('/api/records', async (req, res) => {
    try {
        const records = await Record.find().sort({ createdAt: -1 });
        res.status(200).json(records);
    } catch (error) {
        res.status(500).json({ message: "Server Error: Unable to fetch records", error: error.message });
    }
});

// 2. GET SINGLE RECORD BY ID
app.get('/api/records/:id', async (req, res) => {
    try {
        const record = await Record.findOne({ id: req.params.id });
        if (!record) return res.status(404).json({ message: "Record not found" });
        res.status(200).json(record);
    } catch (error) {
        res.status(500).json({ message: "Server Error", error: error.message });
    }
});

// 3. CREATE NEW RECORD
app.post('/api/records', async (req, res) => {
    try {
        const newRecord = new Record(req.body);
        const savedRecord = await newRecord.save();
        res.status(201).json(savedRecord);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: "Record with this ID already exists." });
        }
        res.status(500).json({ message: "Server Error: Unable to save record", error: error.message });
    }
});

// 4. UPDATE EXISTING RECORD
app.put('/api/records/:id', async (req, res) => {
    try {
        const updatedRecord = await Record.findOneAndUpdate(
            { id: req.params.id }, 
            req.body, 
            { new: true, runValidators: true }
        );
        
        if (!updatedRecord) return res.status(404).json({ message: "Record not found" });
        res.status(200).json(updatedRecord);
    } catch (error) {
        res.status(500).json({ message: "Server Error: Unable to update record", error: error.message });
    }
});

// 5. DELETE RECORD
app.delete('/api/records/:id', async (req, res) => {
    try {
        const deletedRecord = await Record.findOneAndDelete({ id: req.params.id });
        if (!deletedRecord) return res.status(404).json({ message: "Record not found" });
        res.status(200).json({ message: "Record deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server Error: Unable to delete record", error: error.message });
    }
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 VerifyHub Backend Running on Port: ${PORT}`);
});
