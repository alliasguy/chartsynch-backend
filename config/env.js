const dotenv = require('dotenv')
dotenv.config()

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  throw new Error('Please define the JWT_SECRET environment variable')
}

const ATLAS_URI = process.env.ATLAS_URI
if (!ATLAS_URI) {
  throw new Error('Please define the ATLAS_URI environment variable in Vercel')
}

module.exports = { JWT_SECRET, ATLAS_URI }
