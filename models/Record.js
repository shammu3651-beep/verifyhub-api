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
    
    secondaryData: { type: String, default: "[]" }, 
    
    gender: { type: String, default: "" },
    paidMonths: { type: String, default: "" },
    upcCode: { type: String, default: "" },
    groupId: { type: String, default: "" },

    // 🔥 NEW: Smart Soft Delete Fields
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null }
}, {
    timestamps: true,
    strict: false 
});

module.exports = mongoose.model('Record', recordSchema);
