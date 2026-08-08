const express = require('express')
const router = express.Router()
const authController = require('../controllers/authController')
const { authLimiter } = require('../middleware/rateLimiters')

router.post('/api/register', authLimiter, authController.register)
router.get('/:id/refer', authController.referLookup)
router.post('/api/login', authLimiter, authController.login)
router.get('/:id/verify/:token', authController.verifyEmailLink)
router.post('/api/forgotpassword', authLimiter, authController.forgotPassword)
router.post('/api/resetpassword', authLimiter, authController.resetPassword)

module.exports = router
