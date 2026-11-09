/* Outgoing email over SMTP — works with Gmail / Google Workspace (app password), Microsoft 365,
   Resend, SendGrid, Mailgun or a company mail server. Configured with SMTP_* environment variables. */
import nodemailer from 'nodemailer';

export interface MailMessage { to: string[]; cc?: string[]; subject: string; text: string; replyTo?: string }
export interface Mailer {
  /** Human-readable description of the sending account, or null when not configured. */
  from: string | null;
  send(msg: MailMessage): Promise<void>;
}

export function smtpMailer(env: NodeJS.ProcessEnv = process.env): Mailer {
  const host = env.SMTP_HOST;
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASS;
  const from = env.EMAIL_FROM || user || null;
  if (!host || !user || !pass || !from) {
    return { from: null, send: async () => { throw new Error('Email is not set up yet: an admin needs to add SMTP_HOST, SMTP_USER, SMTP_PASS (and optionally EMAIL_FROM) to the server settings.'); } };
  }
  const port = Number(env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  return {
    from,
    async send(msg) {
      await transport.sendMail({ from, to: msg.to, cc: msg.cc, subject: msg.subject, text: msg.text, replyTo: msg.replyTo });
    },
  };
}
