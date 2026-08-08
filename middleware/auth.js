const jwt = require('jsonwebtoken')
const { JWT_SECRET } = require('../config/env')

const verifyAdminToken = (req, res, next) => {
  const token = req.headers['x-access-token']
  if (!token) {
    return res.status(401).json({ status: 401, message: 'No token provided' })
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    if (!decoded.isAdmin) {
      return res.status(403).json({ status: 403, message: 'Forbidden' })
    }
    req.admin = decoded
    next()
  } catch (error) {
    return res.status(401).json({ status: 401, message: 'Invalid or expired token' })
  }
}

module.exports = { verifyAdminToken }
