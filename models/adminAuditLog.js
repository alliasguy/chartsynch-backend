const mongoose = require('mongoose')

const adminAuditLog = new mongoose.Schema(
  {
    adminEmail: { type: String, required: true },
    action: { type: String, required: true },
    targetType: { type: String, default: '' },
    targetId: { type: String, default: '' },
    details: { type: Object, default: {} },
    ip: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
  }
)
const AdminAuditLog = mongoose.models.AdminAuditLog || mongoose.model('AdminAuditLog', adminAuditLog)
module.exports = AdminAuditLog
