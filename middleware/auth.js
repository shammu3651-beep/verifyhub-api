const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'VerifyHub_Elite_Security_Key_2026';

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'Access Denied: Missing Security Token!' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Token Corrupted or Expired!' });
        }
        req.user = user;
        next();
    });
};

module.exports = authenticateToken;
