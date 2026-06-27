const mongoose = require('mongoose');

const baileysAuthSchema = new mongoose.Schema({
    _id: { type: String, required: true }, // Auth key name (e.g., 'creds', 'app-state-sync-key-1')
    data: { type: String, required: true } // JSON Stringified keys
});

module.exports = mongoose.model('BaileysAuth', baileysAuthSchema);
