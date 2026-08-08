const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const User = require('../models/user.model')
const Admin = require('../models/admin')
const Trader = require('../models/trader')
const AdminAuditLog = require('../models/adminAuditLog')
const { JWT_SECRET } = require('../config/env')
const { sendAdminAlert } = require('../utils/email')
const { logAdminAction } = require('../utils/audit')
const { parsePositiveAmount, asString, asObjectId } = require('../utils/validation')

const adminLogin = async (req, res) => {
  try {
    const admin = await Admin.findOne({ email: String(req.body.email || '') })
    if (!admin) {
      return res.status(400).json({ status: 400 })
    }

    const isBcryptHash = /^\$2[aby]\$/.test(admin.password)
    let passwordValid = false

    if (isBcryptHash) {
      passwordValid = await bcrypt.compare(req.body.password || '', admin.password)
    } else {
      // Legacy plaintext password - verify once, then migrate to a bcrypt hash
      passwordValid = admin.password === req.body.password
      if (passwordValid) {
        admin.password = await bcrypt.hash(req.body.password, 12)
        await admin.save()
      }
    }

    if (!passwordValid) {
      return res.status(400).json({ status: 400 })
    }

    const token = jwt.sign({ email: admin.email, isAdmin: true }, JWT_SECRET, { expiresIn: '1d' })
    return res.status(200).json({ status: 200, token })
  } catch (error) {
    console.error('Error during admin login:', error)
    return res.status(500).json({ status: 500, msg: 'Internal server error' })
  }
}

const verifyUser = async (req, res) => {
  const id = asObjectId(req.body.id)
  if (!id) {
    return res.status(400).json({ status: 400, message: 'Invalid user id' })
  }
  try {
    const user = await User.findOne({ _id: id })
    if (!user) {
      return res.status(404).json({ status: 404, message: 'User not found' })
    }
    if (user.verified) {
      await User.updateOne({ _id: id }, {
        verified: false
      })
      res.status(200).json({
        status: 200, verified: user
      })
    }
    else {
      await User.updateOne({ _id: id }, {
        verified: true
      })
      res.status(201).json({
        status: 201, verified: user
      })
    }
  } catch (error) {
    console.error('Error toggling user verification:', error)
    res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

const getUsers = async (req, res) => {
  try {
    const users = await User.find({ deleted: { $ne: true } }).select('-password')
    res.status(200).json(users)
  } catch (error) {
    console.error('Error fetching users:', error)
    res.status(500).json({ status: 'error', message: 'Internal server error' })
  }
}

const fundWallet = async (req, res) => {
  try {
    const email = asString(req.body.email)
    const incomingAmount = parsePositiveAmount(req.body.amount)
    if (!incomingAmount) {
      return res.status(400).json({ status: 'error', message: 'Amount must be a positive number' })
    }
    const user = await User.findOne({ email: email })
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' })
    }
    // $inc instead of read-then-write $set, so two admin credits landing at
    // the same time can't clobber each other (the read-modify-write version
    // loses whichever update commits last).
    await User.updateOne(
      { email: email }, {
      $inc: {
        funded: incomingAmount,
        capital: incomingAmount,
        totaldeposit: incomingAmount
      }
    }
    )
    const upline = user.upline ? await User.findOne({ username: user.upline }) : null
    if (upline) {
      const commission = 10 / 100 * incomingAmount
      await User.updateOne({ username: user.upline }, {
        // refBonus was previously $set to just this commission, overwriting
        // (not accumulating) any bonus from earlier deposits - switched to
        // $inc to match the evident intent of a running referral total.
        $inc: {
          refBonus: commission,
          totalprofit: commission,
          capital: commission,
          funded: commission,
        }
      })
    }

    await User.updateOne(
      { email: email },
      {
        $push: {
          deposit: {
            date: new Date().toLocaleString(),
            amount: incomingAmount,
            id: crypto.randomBytes(32).toString("hex"),
            balance: incomingAmount + user.funded
          }
        }, transaction: {
          type: 'Deposit',
          amount: incomingAmount,
          date: new Date().toLocaleString(),
          balance: incomingAmount + user.funded,
          id: crypto.randomBytes(32).toString("hex"),
        }
      }
    )

    await logAdminAction({
      adminEmail: req.admin.email, action: 'fund_wallet', targetType: 'user', targetId: email, details: { amount: incomingAmount }, ip: req.ip
    })
    await sendAdminAlert('Wallet Credited', `Admin ${req.admin.email} credited $${incomingAmount} to ${email}.`)

    if (upline) {
      res.status(200).json({
        status: 'ok',
        funded: req.body.amount,
        name: user.firstname,
        email: user.email,
        message: `your account has been credited with $${incomingAmount} USD. you can proceed to choosing your preferred investment plan to start earning. Thanks.`,
        subject: 'Deposit Successful',
        uplineName: upline.firstname,
        uplineEmail: upline.email,
        uplineSubject: `Earned Referral Commission`,
        uplineMessage: `Congratulations! You just earned $${10 / 100 * incomingAmount} in commission from ${user.firstname} ${user.lastname}'s deposit of $${incomingAmount}.`
      })
    }
    else {
      res.status(200).json({
        status: 'ok',
        funded: req.body.amount,
        name: user.firstname,
        email: user.email,
        message: `your account has been credited with $${incomingAmount} USD. you can proceed to choosing your preferred investment plan to start earning. Thanks.`,
        subject: 'Deposit Successful',
        upline: null
      })
    }

  } catch (error) {
    console.error('Error funding wallet:', error)
    res.status(500).json({ status: 'error' })
  }
}

const debitWallet = async (req, res) => {
  try {
    const email = asString(req.body.email)
    const incomingAmount = parsePositiveAmount(req.body.amount)
    if (!incomingAmount) {
      return res.status(400).json({ status: 'error', message: 'Amount must be a positive number' })
    }
    const user = await User.findOne({ email: email })
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' })
    }
    if (incomingAmount > user.funded) {
      return res.status(400).json({
        status: 'error',
        funded: req.body.amount,
        error: 'capital cannot be negative'
      })
    }

    await User.updateOne(
      { email: email }, {
      $inc: {
        funded: -incomingAmount,
        capital: -incomingAmount,
      }
    }
    )

    await User.updateOne(
      { email: email },
      {
        $push: {
          deposit: {
            date: new Date().toLocaleString(),
            amount: incomingAmount,
            id: crypto.randomBytes(32).toString("hex"),
            balance: user.funded - incomingAmount
          }
        }, transaction: {
          type: 'debit',
          amount: incomingAmount,
          date: new Date().toLocaleString(),
          balance: user.funded - incomingAmount,
          id: crypto.randomBytes(32).toString("hex"),
        }
      }
    )

    await logAdminAction({
      adminEmail: req.admin.email, action: 'debit_wallet', targetType: 'user', targetId: email, details: { amount: incomingAmount }, ip: req.ip
    })
    await sendAdminAlert('Wallet Debited', `Admin ${req.admin.email} debited $${incomingAmount} from ${email}.`)

    res.status(200).json({
      status: 'ok',
      funded: req.body.amount,
      name: user.firstname,
      email: user.email,
      message: `your account has been debited with $${incomingAmount} USD, Thanks.`,
      subject: 'Debit Alert',
      upline: null
    })

  } catch (error) {
    console.error('Error debiting wallet:', error)
    res.status(500).json({ status: 'error' })
  }
}

const deleteUser = async (req, res) => {
  try {
    const email = String(req.body.email || '')
    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ status: 404, message: 'User not found' })
    }

    await User.updateOne(
      { email },
      { $set: { deleted: true, deletedAt: new Date(), deletedBy: req.admin.email } }
    )

    await logAdminAction({
      adminEmail: req.admin.email, action: 'delete_user', targetType: 'user', targetId: email, ip: req.ip
    })
    await sendAdminAlert(
      'User Deleted',
      `Admin ${req.admin.email} soft-deleted user ${email} (${user.firstname} ${user.lastname}). It can be restored from the Trash panel.`
    )

    return res.status(200).json({ status: 200 })
  } catch (error) {
    console.error('Error deleting user:', error)
    return res.status(500).json({ status: 500, msg: 'Internal server error' })
  }
}

const deleteTrader = async (req, res) => {
  try {
    const id = asObjectId(req.body.id)
    if (!id) {
      return res.status(400).json({ status: 400, message: 'Invalid trader id' })
    }
    const trader = await Trader.findOne({ _id: id })
    if (!trader) {
      return res.status(404).json({ status: 404, message: 'Trader not found' })
    }

    await Trader.updateOne(
      { _id: id },
      { $set: { deleted: true, deletedAt: new Date(), deletedBy: req.admin.email } }
    )

    await logAdminAction({
      adminEmail: req.admin.email, action: 'delete_trader', targetType: 'trader', targetId: id, ip: req.ip
    })
    await sendAdminAlert(
      'Trader Deleted',
      `Admin ${req.admin.email} soft-deleted trader ${trader.firstname} ${trader.lastname} (${id}). It can be restored from the Trash panel.`
    )

    return res.status(200).json({ status: 200 })
  } catch (error) {
    console.error('Error deleting trader:', error)
    return res.status(500).json({ status: 500, msg: 'Internal server error' })
  }
}

const restoreUser = async (req, res) => {
  try {
    const email = String(req.body.email || '')
    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ status: 404, message: 'User not found' })
    }

    await User.updateOne(
      { email },
      { $set: { deleted: false, deletedAt: null, deletedBy: '' } }
    )

    await logAdminAction({
      adminEmail: req.admin.email, action: 'restore_user', targetType: 'user', targetId: email, ip: req.ip
    })
    await sendAdminAlert('User Restored', `Admin ${req.admin.email} restored user ${email}.`)

    return res.status(200).json({ status: 200 })
  } catch (error) {
    console.error('Error restoring user:', error)
    return res.status(500).json({ status: 500, msg: 'Internal server error' })
  }
}

const restoreTrader = async (req, res) => {
  try {
    const id = asObjectId(req.body.id)
    if (!id) {
      return res.status(400).json({ status: 400, message: 'Invalid trader id' })
    }
    const trader = await Trader.findOne({ _id: id })
    if (!trader) {
      return res.status(404).json({ status: 404, message: 'Trader not found' })
    }

    await Trader.updateOne(
      { _id: id },
      { $set: { deleted: false, deletedAt: null, deletedBy: '' } }
    )

    await logAdminAction({
      adminEmail: req.admin.email, action: 'restore_trader', targetType: 'trader', targetId: id, ip: req.ip
    })
    await sendAdminAlert('Trader Restored', `Admin ${req.admin.email} restored trader ${trader.firstname} ${trader.lastname} (${id}).`)

    return res.status(200).json({ status: 200 })
  } catch (error) {
    console.error('Error restoring trader:', error)
    return res.status(500).json({ status: 500, msg: 'Internal server error' })
  }
}

const deletedUsers = async (req, res) => {
  try {
    const users = await User.find({ deleted: true }).select('-password')
    return res.status(200).json({ status: 200, users })
  } catch (error) {
    console.error('Error fetching deleted users:', error)
    return res.status(500).json({ status: 500, msg: 'Internal server error' })
  }
}

const deletedTraders = async (req, res) => {
  try {
    const traders = await Trader.find({ deleted: true })
    return res.status(200).json({ status: 200, traders })
  } catch (error) {
    console.error('Error fetching deleted traders:', error)
    return res.status(500).json({ status: 500, msg: 'Internal server error' })
  }
}

const auditLog = async (req, res) => {
  try {
    const logs = await AdminAuditLog.find().sort({ createdAt: -1 }).limit(200)
    return res.status(200).json({ status: 200, logs })
  } catch (error) {
    console.error('Error fetching audit log:', error)
    return res.status(500).json({ status: 500, msg: 'Internal server error' })
  }
}

const upgradeUser = async (req, res) => {
  try {
    const email = asString(req.body.email)
    const incomingAmount = parsePositiveAmount(req.body.amount)
    if (!incomingAmount) {
      return res.status(400).json({ status: 'error', message: 'Amount must be a positive number' })
    }
    const user = await User.findOne({ email: email })
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' })
    }
    // totalProfit -> totalprofit: the schema field is lowercase, so the
    // old $set silently no-op'd on this field under Mongoose's strict mode.
    await User.updateOne(
      { email: email }, {
      $inc: {
        funded: incomingAmount,
        capital: incomingAmount,
        totalprofit: incomingAmount,
        periodicProfit: incomingAmount
      }
    }
    )
    res.status(200).json({
      status: 'ok',
      funded: req.body.amount
    })
  }
  catch (error) {
    console.error('Error upgrading user:', error)
    res.status(500).json({
      status: 'error',
    })
  }
}

const updateTraderLog = async (req, res) => {
  try {
    const {
      tradeLog
    } = req.body
    const id = asObjectId(tradeLog?.id)
    if (!id) {
      return res.status(400).json({ status: 'error', message: 'Invalid trader id' })
    }
    const validatedAmount = parsePositiveAmount(tradeLog.amount)
    if (!validatedAmount) {
      return res.status(400).json({ status: 'error', message: 'Trade log amount must be a positive number' })
    }
    if (tradeLog.tradeType !== 'profit' && tradeLog.tradeType !== 'loss') {
      return res.status(400).json({ status: 'error', message: "tradeType must be 'profit' or 'loss'" })
    }
    tradeLog.amount = validatedAmount
    const updatedTrader = await Trader.updateOne(
      { _id: id }, {
      $push: {
        tradehistory: tradeLog
      }
    }
    )
    // totalProfit -> totalprofit: the schema field is lowercase, so the old
    // $inc silently no-op'd on this field under Mongoose's strict mode.
    const signedAmount = tradeLog.tradeType === 'profit' ? tradeLog.amount : -tradeLog.amount
    const updatedUsers = await User.updateMany({ trader: id }, {
      $push: {
        trades: tradeLog
      },
      $inc: {
        funded: signedAmount,
        capital: signedAmount,
        totalprofit: signedAmount,
      }
    })
    res.status(200).json({
      status: 'ok', trader: updatedTrader, users: updatedUsers
    })
  }
  catch (error) {
    console.error('Error updating trader log:', error)
    res.status(500).json({
      status: 'error',
    })
  }
}

const distributeProfit = async (req, res) => {
  try {
    const { distributions, traderId, addToHistory, masterTradeLog } = req.body

    const results = await Promise.all(distributions.map(async (dist) => {
      try {
        const email = asString(dist.email)
        const { amount, type, pair } = dist
        const numericAmount = parsePositiveAmount(amount)
        if (!numericAmount) {
          return { email, status: 'error', error: 'Amount must be a positive number' }
        }
        if (type !== 'profit' && type !== 'loss') {
          return { email, status: 'error', error: "type must be 'profit' or 'loss'" }
        }

        // Define trade log for user
        const userTradeLog = {
          pair: pair || (masterTradeLog ? masterTradeLog.pair : 'Unknown'),
          amount: numericAmount,
          tradeType: type, // 'profit' or 'loss'
          date: new Date().toLocaleDateString(),
          id: crypto.randomBytes(16).toString("hex")
        }

        // totalProfit -> totalprofit: the schema field is lowercase, so the
        // old $inc silently no-op'd on this field under Mongoose's strict mode.
        const signedAmount = type === 'profit' ? numericAmount : -numericAmount
        const updateOperation = {
          $push: { trades: userTradeLog },
          $inc: {
            funded: signedAmount,
            capital: signedAmount,
            totalprofit: signedAmount,
          }
        }

        const updatedUser = await User.updateOne({ email: email }, updateOperation)
        return { email, status: 'ok', user: updatedUser }

      } catch (err) {
        console.error(`Error updating user ${dist.email}:`, err)
        return { email: dist.email, status: 'error', error: err.message }
      }
    }))

    // Optionally update trader's master history
    const validTraderId = asObjectId(traderId)
    if (addToHistory && masterTradeLog && validTraderId) {
      await Trader.updateOne(
        { _id: validTraderId },
        { $push: { tradehistory: masterTradeLog } }
      )
    }

    res.status(200).json({ status: 'ok', results })

  } catch (error) {
    console.error("Global distribution error:", error)
    res.status(500).json({ status: 'error', message: 'Internal server error' })
  }
}

const getWithdrawInfo = async (req, res) => {
  const email = asString(req.body.email)

  try {
    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ status: 'error', user: false, message: 'User not found' })
    }

    const userAmount = parsePositiveAmount(user.withdrawAmount)
    if (!userAmount) {
      return res.status(400).json({ status: 'error', message: 'No pending withdrawal amount for this user' })
    }
    await User.updateOne(
      { email },
      { $inc: { funded: -userAmount, totalwithdraw: userAmount, capital: -userAmount }, $set: { withdrawAmount: 0 } }
    )
    await User.updateOne(
      { email },
      {
        $push: {
          withdraw: {
            date: new Date().toLocaleString(),
            amount: userAmount,
            id: crypto.randomBytes(32).toString("hex"),
            balance: user.funded - userAmount
          }
        }
      }
    )
    const now = new Date()
    await User.updateOne(
      { email },
      {
        $push: {
          transaction: {
            type: 'withdraw',
            amount: userAmount,
            date: now.toLocaleString(),
            balance: user.funded - userAmount,
            id: crypto.randomBytes(32).toString("hex"),
          }
        }
      }
    )
    return res.status(200).json({ status: 'ok', amount: userAmount })
  }
  catch (err) {
    console.error('Error processing withdrawal approval:', err)
    return res.status(500).json({ status: 'error', user: false })
  }
}

const approveKYC = async (req, res) => {
  try {
    const email = String(req.body.email)

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' })
    }
    if (user.kycStatus !== 'processing') {
      return res.status(400).json({ status: 'error', message: 'This user has no pending KYC submission to approve' })
    }

    await User.updateOne(
      { email },
      {
        $set: {
          kycStatus: 'approved',
          kycApprovedDate: new Date().toLocaleString(),
          kycRejectionReason: ''
        }
      }
    )

    await logAdminAction({
      adminEmail: req.admin.email, action: 'approve_kyc', targetType: 'user', targetId: email, ip: req.ip
    })
    await sendAdminAlert('KYC Approved', `Admin ${req.admin.email} approved KYC for ${email}.`)

    res.status(200).json({
      status: 'ok',
      message: 'KYC approved successfully',
      userName: user.firstname,
      userEmail: user.email
    })
  } catch (error) {
    console.error('Error approving KYC:', error)
    res.status(500).json({ status: 'error', message: 'Internal server error' })
  }
}

const rejectKYC = async (req, res) => {
  try {
    const email = String(req.body.email)
    const { reason } = req.body

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' })
    }
    if (user.kycStatus !== 'processing') {
      return res.status(400).json({ status: 'error', message: 'This user has no pending KYC submission to reject' })
    }

    await User.updateOne(
      { email },
      {
        $set: {
          kycStatus: 'rejected',
          kycRejectionReason: reason || 'Documents do not meet requirements',
          kycApprovedDate: ''
        }
      }
    )

    await logAdminAction({
      adminEmail: req.admin.email, action: 'reject_kyc', targetType: 'user', targetId: email, details: { reason }, ip: req.ip
    })
    await sendAdminAlert('KYC Rejected', `Admin ${req.admin.email} rejected KYC for ${email}. Reason: ${reason || 'Documents do not meet requirements'}`)

    res.status(200).json({
      status: 'ok',
      message: 'KYC rejected',
      userName: user.firstname,
      userEmail: user.email
    })
  } catch (error) {
    console.error('Error rejecting KYC:', error)
    res.status(500).json({ status: 'error', message: 'Internal server error' })
  }
}

module.exports = {
  adminLogin,
  verifyUser,
  getUsers,
  fundWallet,
  debitWallet,
  deleteUser,
  deleteTrader,
  restoreUser,
  restoreTrader,
  deletedUsers,
  deletedTraders,
  auditLog,
  upgradeUser,
  updateTraderLog,
  distributeProfit,
  getWithdrawInfo,
  approveKYC,
  rejectKYC
}
