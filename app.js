const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
require('./config/env')
const { connectDB } = require('./config/db')
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler')
const authRoutes = require('./routes/authRoutes')
const userRoutes = require('./routes/userRoutes')
const adminRoutes = require('./routes/adminRoutes')
const traderRoutes = require('./routes/traderRoutes')
const cronRoutes = require('./routes/cronRoutes')

const app = express()

app.set('trust proxy', 1)

// Sets standard defensive HTTP headers (X-Content-Type-Options, no X-Powered-By,
// etc.). CSP is left at helmet's default, which is safe here since this app
// only ever serves JSON, never HTML.
app.use(helmet())

const allowedOrigins = ['https://www.elitesynch.com', 'https://elitesynch.com', 'http://localhost:3000']
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no Origin header (server-to-server calls, e.g. Vercel Cron)
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true)
    }
    return callback(new Error('Not allowed by CORS'))
  }
}))
app.use(express.json())

// Fire-and-forget so cold starts don't block on this, but caught so a bad
// connection string / auth failure doesn't crash the process via an
// unhandled rejection.
connectDB().catch((error) => {
  console.error('Initial MongoDB connection failed:', error.message)
})

app.use(authRoutes)
app.use(userRoutes)
app.use(adminRoutes)
app.use(traderRoutes)
app.use(cronRoutes)

app.use(notFoundHandler)
app.use(errorHandler)

module.exports = app
