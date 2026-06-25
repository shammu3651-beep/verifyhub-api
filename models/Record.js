const mongoose = require('mongoose');

const recordSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    transactionType: { type: String, default: "" },
    primaryType: { type: String, default: "" },
    phoneNumber: { type: String, default: "" },
    customerName: { type: String, default: "" },
    date: { type: String, default: "" },
    activationDate: { type: String, default: "" },
    verificationDueDate: { type: String, default: "" },
    status: { type: String, default: "Pending" },
    planValue: { type: String, default: "" },
    billDate: { type: String, default: "" },
    lastCallReason: { type: String, default: "" },
    remarks: { type: String, default: "" },
    
    // Default valid JSON array to prevent Android Kotlin crashes
    secondaryData: { type: String, default: "[]" }, 
    
    // Missing fields added for Android app compatibility
    gender: { type: String, default: "" },
    paidMonths: { type: String, default: "" },
    upcCode: { type: String, default: "" },
    groupId: { type: String, default: "" }
}, {
    timestamps: true,
    // Prevents Mongoose from dropping unknown fields
    strict: false 
});

module.exports = mongoose.model('Record', recordSchema);
