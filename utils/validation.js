const mongoose = require('mongoose')

// Rejects non-numeric, non-finite, zero, or negative amounts before any
// balance-affecting write - previously several routes trusted req.body.amount
// as-is, so e.g. a negative "withdraw" amount would net-credit the account
// once an admin approved it.
const parsePositiveAmount = (value) => {
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

// express.json() happily parses request bodies containing nested objects
// (e.g. { "email": { "$ne": null } }), and Mongo/Mongoose will honor those as
// query operators if a raw body value is dropped straight into a filter.
// Every identifier used in a Mongo filter is passed through one of these
// first so a crafted object body can never be interpreted as an operator -
// it just becomes a string that matches nothing.
const asString = (value) => (typeof value === 'string' || typeof value === 'number') ? String(value) : ''
const asObjectId = (value) => (typeof value === 'string' && mongoose.isValidObjectId(value)) ? value : null

module.exports = { parsePositiveAmount, asString, asObjectId }
