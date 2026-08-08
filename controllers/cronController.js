const User = require('../models/user.model')

const change = (users, now) => {
  users.forEach((user) => {

    user.investment.map(async (invest) => {
      if (isNaN(invest.started)) {
        console.log('investment is not a number')
        return
      }
      if (user.investment == []) {
        console.log('investment is an empty array')
        return
      }
      if (now - invest.started >= invest.ended) {
        console.log('investment completed')
        return
      }
      if (isNaN(invest.profit)) {
        console.log('investment profit is not a number')
        return
      }
      else {
        try {
          // $inc instead of read-then-write $set (avoids lost updates across
          // overlapping cron runs), and totalProfit -> totalprofit to match
          // the actual schema field name - the old $set used a field name
          // that doesn't exist on the schema, which Mongoose's strict mode
          // silently drops, so this never actually updated total profit.
          await User.updateOne(
            { email: user.email },
            {
              $inc: {
                funded: invest.profit,
                periodicProfit: invest.profit,
                capital: invest.profit,
                totalprofit: invest.profit
              }
            }
          )
        } catch (error) {
          console.error('Error applying periodic profit:', error)
        }
      }
    })
  })
}

const runCron = async (req, res) => {
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers['authorization']
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ status: 401, message: 'Unauthorized' })
    }
  }
  try {
    const users = (await User.find({ deleted: { $ne: true } })) ?? []
    const now = new Date().getTime()
    change(users, now)
    return res.status(200).json({ status: 200 })
  } catch (error) {
    console.error('Error running cron job:', error)
    return res.status(500).json({ status: 500, message: 'error! timeout' })
  }
}

module.exports = { runCron }
