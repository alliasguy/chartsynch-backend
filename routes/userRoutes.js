const express = require('express')
const router = express.Router()
const userController = require('../controllers/userController')
const { authLimiter } = require('../middleware/rateLimiters')

router.post('/api/copytrade', userController.copytrade)
router.post('/api/stopcopytrade', userController.stopcopytrade)
router.get('/api/getData', userController.getData)
router.post('/api/updateUserData', userController.updateUserData)
router.post('/api/changePassword', authLimiter, userController.changePassword)
router.post('/api/invest', userController.invest)
router.post('/api/withdraw', userController.withdraw)
router.post('/api/sendproof', userController.sendproof)
router.post('/api/submitKYC', userController.submitKYC)

module.exports = router
