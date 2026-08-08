const express = require('express')
const router = express.Router()
const cronController = require('../controllers/cronController')

router.get('/api/cron', cronController.runCron)

module.exports = router
