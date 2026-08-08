const express = require('express')
const router = express.Router()
const traderController = require('../controllers/traderController')
const { verifyAdminToken } = require('../middleware/auth')

router.post('/api/createTrader', verifyAdminToken, traderController.createTrader)
router.get('/api/fetchTraders', traderController.fetchTraders)

module.exports = router
