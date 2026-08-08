// Catches requests to routes that don't exist.
const notFoundHandler = (req, res) => {
  res.status(404).json({ status: 'error', message: 'Not found' })
}

// Last-resort handler for anything a route didn't catch itself - notably the
// CORS origin check in app.js calls next(new Error(...)) on a disallowed
// origin, which lands here. Without this, Express's default error handler
// could leak a stack trace to the client depending on NODE_ENV; this always
// returns a generic message and logs the real error server-side instead.
const errorHandler = (err, req, res, next) => {
  console.error('Unhandled error:', err)
  if (res.headersSent) {
    return next(err)
  }
  res.status(err.message === 'Not allowed by CORS' ? 403 : 500)
    .json({ status: 'error', message: err.message === 'Not allowed by CORS' ? 'Not allowed by CORS' : 'Internal server error' })
}

module.exports = { notFoundHandler, errorHandler }
