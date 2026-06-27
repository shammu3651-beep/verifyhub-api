const express = require('express');
const router = express.Router();
const { getWhatsAppStatus } = require('../services/whatsappService');
const authenticateToken = require('../middleware/auth');
// Modular Zero-Trust middleware imported successfully

// GET /api/whatsapp/status
router.get('/status', authenticateToken, (req, res) => {
    try {
        const status = getWhatsAppStatus();
        res.status(200).json({ success: true, data: status });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch WhatsApp status" });
    }
});

module.exports = router;
