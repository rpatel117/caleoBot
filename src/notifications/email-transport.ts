import * as nodemailer from 'nodemailer';

export async function createTransport(): Promise<nodemailer.Transporter> {
  const smtpUser = process.env.SES_SMTP_USER;
  const smtpPass = process.env.SES_SMTP_PASS;
  const smtpHost = process.env.SES_SMTP_HOST || 'email-smtp.us-east-1.amazonaws.com';

  if (smtpUser && smtpPass) {
    console.log(`[Notifications] Using SES SMTP (${smtpHost})`);
    return nodemailer.createTransport({
      host: smtpHost,
      port: 465,
      secure: true,
      auth: { user: smtpUser, pass: smtpPass },
    });
  }

  // Fallback: Ethereal test account (captures emails without sending)
  const testAccount = await nodemailer.createTestAccount();
  console.log('[Notifications] Using Ethereal test account (no real emails sent)');
  return nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: { user: testAccount.user, pass: testAccount.pass },
  });
}
