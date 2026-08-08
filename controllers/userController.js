const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const User = require('../models/user.model')
const { JWT_SECRET } = require('../config/env')
const { parsePositiveAmount } = require('../utils/validation')

const copytrade = async (req, res) => {
  const token = req.headers['x-access-token']
  const { traderId, amount } = req.body
  try {
    const decode = jwt.verify(token, JWT_SECRET)
    const email = decode.email
    const user = await User.findOne({ email: email })

    if (!user) {
      return res.status(404).json({ status: 404, message: 'User not found' })
    }

    // Prevent duplicate subscriptions to the same trader
    const alreadyCopying = user.subscriptions && user.subscriptions.some(s => s.traderId === traderId)
    if (alreadyCopying) {
      return res.status(400).json({ status: 400, message: 'You are already copying this trader' })
    }

    const allocatedAmount = parsePositiveAmount(amount) || 0

    await User.updateOne(
      { email: email },
      {
        $push: {
          subscriptions: {
            traderId: traderId,
            allocatedAmount: allocatedAmount,
            currentEquity: allocatedAmount
          }
        },
        $set: { trader: traderId } // kept for admin dashboard backward compatibility
      }
    )

    res.status(200).json({ status: 200, message: 'Trader successfully added to your portfolio' })

  } catch (error) {
    console.error('Error in copytrade:', error)
    res.status(error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError' ? 401 : 500)
      .json({ status: 400, message: 'Could not copy trader' })
  }
}

const stopcopytrade = async (req, res) => {
  const token = req.headers['x-access-token']
  const { traderId } = req.body
  try {
    const decode = jwt.verify(token, JWT_SECRET)
    const email = decode.email
    const user = await User.findOne({ email: email })

    if (!user) {
      return res.status(404).json({ status: 404, message: 'User not found' })
    }

    await User.updateOne(
      { email: email },
      {
        $pull: { subscriptions: { traderId: traderId } },
        $set: { trader: '' }
      }
    )

    res.status(200).json({ status: 200, message: 'Trader successfully removed from your portfolio' })

  } catch (error) {
    console.error('Error in stopcopytrade:', error)
    res.status(error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError' ? 401 : 500)
      .json({ status: 400, message: 'Could not stop copying trader' })
  }
}

const getData = async (req, res) => {
  const token = req.headers['x-access-token']
  try {
    // Ensure token is provided
    if (!token) {
      return res.status(401).json({ status: 'error', message: 'No token provided' })
    }

    // Verify token and decode user details
    const decoded = jwt.verify(token, JWT_SECRET)
    const email = String(decoded.email)

    // Fetch user data
    const user = await User.findOne({ email, deleted: { $ne: true } })
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' })
    }

    // Respond with user details
    res.status(200).json({
      status: 'ok',
      firstname: user.firstname,
      lastname: user.lastname,
      username: user.username,
      email: user.email,
      funded: user.funded,
      invest: user.investment,
      transaction: user.transaction,
      withdraw: user.withdraw,
      refBonus: user.refBonus,
      referred: user.referred,
      referral: user.referral,
      phonenumber: user.phonenumber,
      state: user.state,
      zipcode: user.zipcode,
      address: user.address,
      profilepicture: user.profilepicture,
      country: user.country,
      totalprofit: user.totalprofit,
      totaldeposit: user.totaldeposit,
      totalwithdraw: user.totalwithdraw,
      deposit: user.deposit,
      promo: user.promo,
      periodicProfit: user.periodicProfit,
      trader: user.trader,
      subscriptions: user.subscriptions || [],
      rank: user.rank,
      server: user.server,
      trades: user.trades,
      verified: user.verified
    })
  } catch (error) {
    console.error('Error fetching user data:', error.message)

    // Differentiate between invalid token and server error
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ status: 'error', message: 'Invalid token' })
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ status: 'error', message: 'Token expired' })
    }

    // Handle other server errors
    res.status(500).json({ status: 'error', message: 'Internal server error' })
  }
}

// Fields a user is allowed to self-edit through this endpoint. Everything
// else (funded, capital, totalprofit, verified, kycStatus, password, rank,
// subscriptions, email, ...) used to be reachable here too - the old handler
// $set anything in req.body that differed from the current document, so any
// authenticated user could set their own balance/verification/KYC status
// directly. password is handled by the dedicated /api/changePassword route
// instead, since it needs current-password verification and hashing.
const SELF_EDITABLE_USER_FIELDS = ['profilepicture']

const updateUserData = async (req, res) => {
  const token = req.headers['x-access-token']

  try {
    const decode = jwt.verify(token, JWT_SECRET)
    const email = decode.email
    const user = await User.findOne({ email: email })

    if (!user) {
      return res.status(404).json({ status: 400, message: "User not found" })
    }

    const updatedFields = {}
    SELF_EDITABLE_USER_FIELDS.forEach((key) => {
      if (req.body[key] !== undefined && req.body[key] !== user[key]) {
        updatedFields[key] = req.body[key]
      }
    })

    // Update only if there are changes
    if (Object.keys(updatedFields).length > 0) {
      await User.updateOne({ email: user.email }, { $set: updatedFields })
      return res.status(200).json({ status: 200, message: "Profile updated successfully" })
    }

    return res.status(400).json({ status: 400, message: "No changes were made" })

  } catch (error) {
    console.error('Error updating user data:', error.message)
    return res.status(500).json({ status: 500, message: "Internal server error" })
  }
}

// Dedicated password-change route: requires the caller to prove they know
// the current password before a new one is set. Previously password changes
// went through /api/updateUserData's generic $set-anything-that-changed
// logic, which (a) never checked the current password at all - so a stolen
// session token alone was enough to lock the real owner out - and (b) stored
// the new password unhashed, relying on the login route's legacy-plaintext
// migration path to eventually bcrypt-hash it on the user's next login.
const changePassword = async (req, res) => {
  const token = req.headers['x-access-token']

  try {
    if (!token) {
      return res.status(401).json({ status: 'error', message: 'No token provided' })
    }
    const decoded = jwt.verify(token, JWT_SECRET)
    const email = String(decoded.email)
    const { currentPassword, newPassword } = req.body

    if (!currentPassword || !newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ status: 'error', message: 'Current password and a new password (min 6 characters) are required' })
    }

    const user = await User.findOne({ email, deleted: { $ne: true } })
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' })
    }

    const isBcryptHash = /^\$2[aby]\$/.test(user.password)
    const currentPasswordValid = isBcryptHash
      ? await bcrypt.compare(currentPassword, user.password)
      : user.password === currentPassword

    if (!currentPasswordValid) {
      return res.status(401).json({ status: 'error', message: 'Current password is incorrect' })
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12)
    await User.updateOne({ email }, { $set: { password: hashedPassword } })

    return res.status(200).json({ status: 'ok', message: 'Password updated successfully' })
  } catch (error) {
    console.error('Error changing password:', error)
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ status: 'error', message: 'Invalid token' })
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ status: 'error', message: 'Token expired' })
    }
    return res.status(500).json({ status: 'error', message: 'Internal server error' })
  }
}

const INVESTMENT_PERCENTS = { '20%': 20, '35%': 35, '50%': 50, '65%': 65, '80%': 80, '100%': 100 }

const invest = async (req, res) => {
  const token = req.headers['x-access-token']
  try {
    const decode = jwt.verify(token, JWT_SECRET)
    const email = decode.email
    const user = await User.findOne({ email: email })
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' })
    }

    const amount = parsePositiveAmount(req.body.amount)
    const percent = INVESTMENT_PERCENTS[req.body.percent]
    if (!amount || percent === undefined) {
      return res.status(400).json({ status: 'error', message: 'A positive amount and a valid percent are required' })
    }
    const money = (amount * percent) / 100

    if (user.capital >= amount) {
      const now = new Date()
      await User.updateOne(
        { email: email },
        {
          $set: { capital: user.capital - amount, totalprofit: user.totalprofit + money, withdrawDuration: now.getTime() },
        }
      )
      await User.updateOne(
        { email: email },
        {
          $push: {
            investment:
            {
              type: 'investment',
              amount: amount,
              plan: req.body.plan,
              percent: req.body.percent,
              startDate: now.toLocaleString(),
              endDate: now.setDate(now.getDate() + 432000).toLocaleString(),
              profit: money,
              ended: 259200000,
              started: now.getTime(),
              periodicProfit: 0
            },
            transaction: {
              type: 'investment',
              amount: amount,
              date: now.toLocaleString(),
              balance: user.funded + amount,
              id: crypto.randomBytes(32).toString("hex")
            }
          }
        }
      )
      res.json({ status: 'ok', amount: amount })
    } else {
      res.json({
        message: 'Insufficient capital!',
        status: 400
      })
    }
  } catch (error) {
    console.error('Error processing investment:', error)
    return res.json({ status: 500, error: 'Internal server error' })
  }
}

const withdraw = async (req, res) => {
  const token = req.headers['x-access-token']
  try {
    const decode = jwt.verify(token, JWT_SECRET)
    const email = decode.email
    const user = await User.findOne({ email: email })
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' })
    }
    const withdrawAmount = parsePositiveAmount(req.body.WithdrawAmount)
    if (!withdrawAmount) {
      return res.status(400).json({ status: 'error', message: 'Withdrawal amount must be a positive number' })
    }
    if (user.funded >= withdrawAmount) {

      await User.updateOne(
        { email: email },
        { $set: { withdrawAmount } }
      )
      return res.status(200).json({
        status: 'ok',
        withdraw: withdrawAmount,
        email: user.email,
        name: user.firstname,
        message: `We have received your withdrawal order, kindly exercise some patience as our management board approves your withdrawal`,
        subject: 'Withdrawal Order Alert',
        adminMessage: `Hello BOSS! a user with the name ${user.firstname} placed withdrawal of $${withdrawAmount} USD, to be withdrawn into ${req.body.wallet} ${req.body.method} wallet`,
      })
    }

    else {
      res.status(400).json({
        status: 400,
        subject: 'Failed Withdrawal Alert',
        email: user.email,
        name: user.firstname,
        withdrawMessage: `We have received your withdrawal order, but you can only withdraw you insufficient amount in your account. Kindly deposit and invest more, to rack up more profit, Thanks.`
      })
    }
  }
  catch (error) {
    console.error('Error processing withdrawal:', error)
    res.status(error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError' ? 401 : 500)
      .json({ status: 'error', message: 'internal server error' })
  }
}

const sendproof = async (req, res) => {
  const token = req.headers['x-access-token']
  try {
    const decode = jwt.verify(token, JWT_SECRET)
    const email = decode.email
    const amount = parsePositiveAmount(req.body.amount)
    if (!amount) {
      return res.status(400).json({ status: 400, message: 'Amount must be a positive number' })
    }
    const user = await User.findOne({ email: email })
    if (user) {
      return res.status(200).json({
        status: 200,
        email: user.email,
        name: user.firstname,
        message: `Hi! you have successfully placed a deposit order, kindly exercise some patience as we verify your deposit. Your account will automatically be credited with $${amount} USD after verification.`,
        subject: 'Pending Deposit Alert',
        adminMessage: `hello BOSS, a user with the name.${user.firstname}, just deposited $${amount} USD into to your ${req.body.method} wallet. please confirm deposit and credit.`,
        adminSubject: 'Deposit Alert'
      })
    }
    else {
      // Frontend (Deposit.jsx) specifically checks res.status === 500 in the
      // response BODY for this "user not found" case - that value is kept
      // as-is (rather than a more correct 404) to avoid silently breaking
      // that check. Deposit.jsx uses plain fetch() here (not axios), which
      // doesn't throw on a non-2xx HTTP status, so the HTTP status itself is
      // safe to make accurate.
      return res.status(404).json({ status: 500, message: 'User not found' })
    }
  } catch (error) {
    console.error('Error in sendproof:', error)
    res.status(error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError' ? 401 : 500)
      .json({ status: 404, message: 'Could not process deposit proof' })
  }
}

// KYC Submission
const KYC_REQUIRED_FIELDS = [
  'middlename', 'dateOfBirth', 'nationality', 'city', 'address',
  'employmentStatus', 'occupation', 'annualIncome', 'sourceOfFunds', 'investmentExperience',
  'idType', 'idNumber', 'idExpiry', 'idDocumentFront', 'idDocumentBack', 'proofOfAddress', 'selfiePhoto'
]

const submitKYC = async (req, res) => {
  const token = req.headers['x-access-token']

  try {
    if (!token) {
      return res.status(401).json({ status: 'error', message: 'No token provided' })
    }

    const decoded = jwt.verify(token, JWT_SECRET)
    const email = String(decoded.email)

    const {
      middlename,
      dateOfBirth,
      nationality,
      city,
      address,
      employmentStatus,
      occupation,
      annualIncome,
      sourceOfFunds,
      investmentExperience,
      idType,
      idNumber,
      idExpiry,
      idDocumentFront,
      idDocumentBack,
      proofOfAddress,
      selfiePhoto
    } = req.body

    const kycData = {
      middlename, dateOfBirth, nationality, city, address,
      employmentStatus, occupation, annualIncome, sourceOfFunds, investmentExperience,
      idType, idNumber, idExpiry, idDocumentFront, idDocumentBack, proofOfAddress, selfiePhoto
    }

    const missingField = KYC_REQUIRED_FIELDS.find((field) => !kycData[field])
    if (missingField) {
      return res.status(400).json({ status: 'error', message: `Missing required field: ${missingField}` })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' })
    }

    if (user.kycStatus === 'processing' || user.kycStatus === 'approved') {
      return res.status(400).json({
        status: 'error',
        message: user.kycStatus === 'approved'
          ? 'KYC is already approved for this account'
          : 'KYC is already under review'
      })
    }

    // Update user with KYC data
    await User.updateOne(
      { email },
      {
        $set: {
          ...kycData,
          kycStatus: 'processing',
          kycSubmittedDate: new Date().toLocaleString(),
          kycRejectionReason: ''
        }
      }
    )

    res.status(200).json({
      status: 'ok',
      message: 'KYC submitted successfully and is under review'
    })
  } catch (error) {
    console.error('Error submitting KYC:', error)

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ status: 'error', message: 'Invalid token' })
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ status: 'error', message: 'Token expired' })
    }

    res.status(500).json({ status: 'error', message: 'Internal server error' })
  }
}

module.exports = {
  copytrade,
  stopcopytrade,
  getData,
  updateUserData,
  changePassword,
  invest,
  withdraw,
  sendproof,
  submitKYC
}
