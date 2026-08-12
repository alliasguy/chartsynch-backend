const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const User = require('../models/user.model')
const Token = require('../models/token')
const { JWT_SECRET } = require('../config/env')
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/email')
const { asString, asObjectId } = require('../utils/validation')

const register = async (req, res) => {
  const { firstName, lastName, userName, password, server, phonenumber, deviceName, country } = req.body
  const referralLink = asString(req.body.referralLink)
  const email = String(req.body.email || '').toLowerCase().trim()
  const cleanFirstName = String(firstName || '').trim()
  const cleanLastName = String(lastName || '').trim()
  const cleanUserName = String(userName || '').trim()
  const cleanPassword = String(password || '').trim()
  const now = new Date()

  if (!cleanFirstName || !cleanLastName || !cleanUserName || !email || !cleanPassword) {
    return res.status(400).json({ status: 'error', message: 'All required fields (first name, last name, username, email, password) must be provided.' })
  }

  try {
    // Check if the user already exists (by email or username)
    const existingUser = await User.findOne({
      $or: [{ email }, { username: cleanUserName }]
    })
    if (existingUser) {
      const isEmailMatch = existingUser.email === email
      return res.status(409).json({
        status: 'error',
        message: isEmailMatch ? 'An account with this email already exists' : 'Username is already taken'
      })
    }

    const hashedPassword = await bcrypt.hash(cleanPassword, 12)

    // Check for referring user
    const referringUser = referralLink ? await User.findOne({ username: referralLink }) : null
    if (referringUser) {
      await User.updateOne(
        { username: referralLink },
        {
          $push: {
            referred: {
              firstname: cleanFirstName,
              lastname: cleanLastName,
              email: email,
              date: now.toLocaleString(),
              refBonus: 15,
            },
          },
          $inc: {
            refBonus: 500,
            totalprofit: 15,
            funded: 15,
            capital: 15
          }
        }
      )
    }

    // Create a new user
    const newUser = await User.create({
      firstname: cleanFirstName,
      lastname: cleanLastName,
      username: cleanUserName,
      email,
      phonenumber,
      password: hashedPassword,
      funded: 0,
      investment: [],
      transaction: [],
      withdraw: [],
      rememberme: false,
      referral: crypto.randomBytes(32).toString('hex'),
      refBonus: 0,
      referred: [],
      periodicProfit: 0,
      upline: referralLink || null,
      trades: [],
      server: server || "server1"
    })

    // Generate JWT token
    const token = jwt.sign(
      { id: newUser._id, email: newUser.email },
      JWT_SECRET,
      { expiresIn: '1h' }
    )

    // Create verification code safely
    try {
      await Token.findOneAndUpdate(
        { userId: newUser._id },
        { token: token },
        { upsert: true, new: true }
      )
    } catch (tokenErr) {
      console.error('Error saving verification token:', tokenErr)
    }

    const verificationLink = `https://www.chartsynch.com/${newUser._id}/verify/${token}`

    // Sent server-side (not returned in the response)
    try {
      await sendVerificationEmail({ to: newUser.email, name: newUser.firstname, verificationLink })
    } catch (emailError) {
      console.error('Error sending verification email:', emailError)
    }

    // Prepare response data
    const response = {
      status: 'ok',
      email: newUser.email,
      name: newUser.firstname,
      token,
      adminSubject: 'User Signup Alert',
      message: `A new user with the following details just signed up:\nName: ${cleanFirstName} ${cleanLastName}\nEmail: ${email} \nlocation: ${country} \ndevice: ${deviceName}`,
      subject: 'Successful User Referral Alert',
      referringUser: referringUser ? referringUser._id : null
    }

    if (referringUser) {
      response.referringUserEmail = referringUser.email
      response.referringUserName = referringUser.firstname
      response.referringUserMessage = `A new user with the name ${cleanFirstName} ${cleanLastName} just signed up with your referral link. You will now earn 10% of every deposit this user makes. Keep referring to earn more.`
    }

    return res.status(201).json(response)
  } catch (error) {
    console.error('Error during user registration:', error)
    return res.status(500).json({ status: 'error', message: 'Server error. Please try again later.' })
  }
}

const referLookup = async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.id })
    if (!user) {
      return res.status(400).json({ status: 400 })
    }
    res.status(200).json({ status: 200, referredUser: req.params.id })
  } catch (error) {
    console.error('Error looking up referrer:', error)
    res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

const login = async (req, res) => {
  try {
    const email = String(req.body.email || '').toLowerCase()
    const { password, rememberme } = req.body

    // Check if the user exists
    // Login.jsx calls this via axios, which throws on any non-2xx response
    // and would then miss the specific status/message this branch sends -
    // kept at the default 200 so axios's .then() handles it as intended.
    const user = await User.findOne({ email, deleted: { $ne: true } })
    if (!user) {
      return res.json({ status: 404, message: 'User does not exist' })
    }

    // Verify password (bcrypt hash, with one-time migration for legacy plaintext accounts)
    const isBcryptHash = /^\$2[aby]\$/.test(user.password)
    let passwordValid = false

    if (isBcryptHash) {
      passwordValid = await bcrypt.compare(password || '', user.password)
    } else {
      // Legacy plaintext password - verify once, then migrate to a bcrypt hash
      passwordValid = user.password === password
      if (passwordValid) {
        user.password = await bcrypt.hash(password, 12)
      }
    }

    if (!passwordValid) {
      return res.json({ status: 401, message: 'Incorrect password' })
    }

    // if (user.verified  === false) {
    //   return res.json({ status: 400, message: 'Email not verified!' });
    // }

    // Generate JWT token with user ID and email
    const token = jwt.sign(
      { id: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' } // Set token to expire in 7 days
    )

    // Update the user's "remember me" status
    user.rememberme = rememberme || false
    await user.save()

    // Send response
    return res.status(200).json({
      status: 'ok',
      token,
      message: 'Login successful',
    })
  } catch (error) {
    console.error('Error during login:', error)
    return res.status(500).json({ status: 'error', message: 'Internal server error' })
  }
}

const verifyEmailLink = async (req, res) => {
  try {
    const id = asObjectId(req.params.id)
    if (!id) {
      return res.status(400).json({ status: 400, message: 'Invalid verification link' })
    }
    const user = await User.findOne({ _id: id })
    if (!user) {
      return res.status(400).json({ status: 400 })
    }
    const token = await Token.findOne({ userId: user._id, token: req.params.token })

    if (!token) {
      return res.status(400).json({ status: 400 })
    }

    try {
      jwt.verify(req.params.token, JWT_SECRET)
    } catch (jwtError) {
      await token.deleteOne()
      return res.status(400).json({ status: 400, message: 'Verification link has expired' })
    }

    await User.updateOne({ _id: user._id }, {
      $set: { verified: true }
    })
    await token.deleteOne()
    res.status(200).json({ status: 200 })
  } catch (error) {
    console.error('Error verifying email:', error)
    res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

// Request a password reset: issues a single-use, time-limited token and
// emails the reset link server-side. Always responds with the same generic
// message regardless of whether the account exists or the email send
// succeeds, so this endpoint can't be used to enumerate registered emails -
// and, critically, the reset link itself is never returned in the response.
// (It previously was: anyone who knew a victim's email could call this
// endpoint directly and receive a valid password-reset link for that
// account without ever touching their inbox.)
const forgotPassword = async (req, res) => {
  const genericResponse = { status: 'ok', message: 'If an account exists for that email, a password reset link has been sent.' }

  try {
    const email = String(req.body.email || '').toLowerCase()

    const user = await User.findOne({ email, deleted: { $ne: true } })
    if (!user) {
      return res.status(200).json(genericResponse)
    }

    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')

    await User.updateOne(
      { email },
      {
        $set: {
          resetPasswordTokenHash: tokenHash,
          resetPasswordExpires: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
        }
      }
    )

    const resetLink = `https://www.chartsynch.com/resetpassword/${email}/${rawToken}`

    try {
      await sendPasswordResetEmail({ to: user.email, name: user.firstname, resetLink })
    } catch (emailError) {
      console.error('Error sending password reset email:', emailError)
    }

    return res.status(200).json(genericResponse)
  } catch (error) {
    console.error('Error requesting password reset:', error)
    return res.status(500).json({ status: 'error', message: 'Could not process password reset request' })
  }
}

const resetPassword = async (req, res) => {
  try {
    const email = String(req.body.email || '').toLowerCase()
    const { newPassword, token } = req.body

    if (!token || !newPassword) {
      return res.status(400).json({ status: 'error', message: 'Missing reset token or new password' })
    }

    // Check if the user exists
    const user = await User.findOne({ email })
    if (!user) {
      return res.json({ status: 404, message: 'User does not exist' })
    }

    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex')

    if (
      !user.resetPasswordTokenHash ||
      user.resetPasswordTokenHash !== tokenHash ||
      !user.resetPasswordExpires ||
      user.resetPasswordExpires.getTime() < Date.now()
    ) {
      return res.status(400).json({ status: 'error', message: 'Reset link is invalid or has expired' })
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12)

    await User.updateOne(
      { email }, {
      $set: {
        password: hashedPassword,
        resetPasswordTokenHash: '',
        resetPasswordExpires: null
      }
    })
    return res.status(200).json({
      status: 'ok',
      message: 'Password reset successful',
    })
  } catch (error) {
    console.error('password not reset', error)
    return res.json({ status: 'error', message: 'password not reset' })
  }
}

module.exports = {
  register,
  referLookup,
  login,
  verifyEmailLink,
  forgotPassword,
  resetPassword
}
