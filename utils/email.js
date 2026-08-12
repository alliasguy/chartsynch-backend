require('dotenv').config()

const EMAILJS_ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send'

// EmailJS credentials (loaded from env with fallbacks)
const ADMIN_ALERT_SERVICE_ID = process.env.EMAILJS_ADMIN_SERVICE_ID || 'service_xvf59us'
const ADMIN_ALERT_TEMPLATE_ID = process.env.EMAILJS_ADMIN_TEMPLATE_ID || 'template_g6y6gxq'
const ADMIN_ALERT_USER_ID = process.env.EMAILJS_ADMIN_USER_ID || 'ee7CtMRdf3w3NMhRi'

const USER_MAIL_SERVICE_ID = process.env.EMAILJS_USER_SERVICE_ID || 'service_xvf59us'
const USER_MAIL_USER_ID = process.env.EMAILJS_USER_USER_ID || 'ee7CtMRdf3w3NMhRi'
const VERIFY_TEMPLATE_ID = process.env.EMAILJS_VERIFY_TEMPLATE_ID || 'template_1lc11k1'
const GENERIC_TEMPLATE_ID = process.env.EMAILJS_GENERIC_TEMPLATE_ID || 'template_g6y6gxq'

const sendViaEmailJS = async ({ serviceId, templateId, userId, templateParams }) => {
  const payload = {
    service_id: serviceId,
    template_id: templateId,
    user_id: userId,
    template_params: templateParams
  }
  const privateKey = process.env.EMAILJS_PRIVATE_KEY || process.env.EMAILJS_ACCESS_TOKEN
  if (privateKey) {
    payload.accessToken = privateKey
  }

  const response = await fetch(EMAILJS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`EmailJS request failed (${response.status}): ${body}`)
  }
}

// Fires a real-time email alert on destructive/sensitive admin actions, so a
// breach is noticed even if the attacker calls the API directly and never
// touches the dashboard UI.
const sendAdminAlert = async (subject, message) => {
  try {
    await sendViaEmailJS({
      serviceId: ADMIN_ALERT_SERVICE_ID,
      templateId: ADMIN_ALERT_TEMPLATE_ID,
      userId: ADMIN_ALERT_USER_ID,
      templateParams: {
        name: 'Security Alert',
        email: 'support@chartsynch.com',
        message,
        reply_to: 'support@chartsynch.com',
        subject: `[ChartSynch Admin Alert] ${subject}`
      }
    })
  } catch (error) {
    console.error('Error sending admin alert:', error)
  }
}

// Sent server-side so the verification token never has to round-trip through
// the API response - previously the client relayed the link to EmailJS
// itself, which meant it was already fully readable by whoever called the
// registration endpoint.
const sendVerificationEmail = async ({ to, name, verificationLink }) => {
  await sendViaEmailJS({
    serviceId: USER_MAIL_SERVICE_ID,
    templateId: VERIFY_TEMPLATE_ID,
    userId: USER_MAIL_USER_ID,
    templateParams: { name, email: to, verificationLink }
  })
}

// Sent server-side for the same reason as above: returning the raw reset
// token in the API response let anyone who knew (or guessed) an account's
// email obtain a valid password-reset link for that account, without ever
// touching the inbox.
const sendPasswordResetEmail = async ({ to, name, resetLink }) => {
  await sendViaEmailJS({
    serviceId: USER_MAIL_SERVICE_ID,
    templateId: GENERIC_TEMPLATE_ID,
    userId: USER_MAIL_USER_ID,
    templateParams: {
      name: name || 'User',
      email: to,
      message: resetLink,
      reply_to: 'support@chartsynch.com',
      subject: 'Password Reset'
    }
  })
}

module.exports = { sendAdminAlert, sendVerificationEmail, sendPasswordResetEmail }
