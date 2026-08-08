const Trader = require('../models/trader')

const createTrader = async (req, res) => {
  try {
    const {
      firstname,
      lastname,
      nationality,
      winRate, // this doesn't exist in the model, maybe map to profitrate?
      avgReturn,
      followers,
      rrRatio,
      minimumcapital,
      traderImage
    } = req.body

    const newTrader = new Trader({
      firstname,
      lastname,
      nationality,
      profitrate: winRate || '92%', // mapping winRate from frontend
      averagereturn: avgReturn || '90%',
      followers: followers || '50345',
      rrRatio: rrRatio || '1:7',
      minimumcapital: minimumcapital || 5000,
      tradehistory: [], // empty by default
      numberoftrades: '64535', // or set it dynamically later
      traderImage: traderImage
    })

    const savedTrader = await newTrader.save()
    res.status(201).json(savedTrader)
  } catch (error) {
    console.error('Error creating trader:', error)
    res.status(500).json({ message: 'Server error' })
  }
}

const fetchTraders = async (req, res) => {
  try {
    const traders = await Trader.find({ deleted: { $ne: true } })
    res.status(200).json({ status: 200, traders: traders })
  }
  catch (error) {
    console.error('Error fetching traders:', error)
    res.status(500).json({ status: 404, message: 'Internal server error' })
  }
}

module.exports = { createTrader, fetchTraders }
