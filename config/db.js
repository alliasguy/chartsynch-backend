const mongoose = require('mongoose')
const { ATLAS_URI } = require('./env')

/* Global cache so we don't reconnect every time */
let cached = global.mongoose
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null }
}

const connectDB = async () => {
  if (cached.conn) return cached.conn

  if (!cached.promise) {
    cached.promise = mongoose.connect(ATLAS_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }).then((mongoose) => mongoose).catch((error) => {
      // Let a failed connection attempt be retried on the next call instead
      // of permanently caching a rejected promise.
      cached.promise = null
      throw error
    })
  }

  cached.conn = await cached.promise
  return cached.conn
}

module.exports = { connectDB }
