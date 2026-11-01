import nodemailer from "nodemailer"

import { config } from "./config.ts"

const transporter = nodemailer.createTransport({
  host: config.EMAIL_SMTP_HOST,
  port: config.EMAIL_SMTP_PORT,
  secure: config.EMAIL_SMTP_SECURE,
  auth: config.EMAIL_SMTP_USER
    ? {
        user: config.EMAIL_SMTP_USER,
        pass: config.EMAIL_SMTP_PASSWORD,
      }
    : undefined,
})

interface SendEmailOptions {
  to: string
  subject: string
  text: string
  html?: string
}

export function sendEmail(options: SendEmailOptions) {
  return transporter.sendMail({
    from: {
      name: config.EMAIL_FROM_NAME,
      address: config.EMAIL_FROM,
    },
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
  })
}
