const AdminAuditLog = require('../models/adminAuditLog')

// Records who did what to which record, for the admin activity log.
const logAdminAction = async ({ adminEmail, action, targetType, targetId, details, ip }) => {
  try {
    await AdminAuditLog.create({ adminEmail, action, targetType, targetId, details: details || {}, ip: ip || '' })
  } catch (error) {
    console.error('Error logging admin action:', error)
  }
}

module.exports = { logAdminAction }
