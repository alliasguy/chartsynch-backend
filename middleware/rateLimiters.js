const { rateLimit, ipKeyGenerator } = require('express-rate-limit')

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 429, message: 'Too many login attempts. Try again in 15 minutes.' },
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${(req.body?.email || '').toLowerCase()}`,
})

// Shared limiter for user-facing auth endpoints (login, register, password reset)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 429, message: 'Too many attempts. Try again in 15 minutes.' },
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${(req.body?.email || '').toLowerCase()}`,
})

// Caps how many destructive admin actions (delete, etc.) can happen in a
// short window per admin, so a compromised admin token can't wipe the
// platform in seconds.
const destructiveActionLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 429, message: 'Too many admin actions in a short time. Please slow down.' },
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${req.admin?.email || ''}`,
})

module.exports = { adminLoginLimiter, authLimiter, destructiveActionLimiter }
