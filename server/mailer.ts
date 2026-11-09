/* Outgoing email. Two ways to send, chosen by environment variables:

   1. Microsoft 365 via Microsoft Graph (recommended for Microsoft tenants — no password stored):
        MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER (the mailbox it sends from)
      Needs an app registration in Microsoft Entra with the Mail.Send *application* permission
      (admin-consented). Microsoft is retiring password-based SMTP for Microsoft 365.

   2. Any SMTP account (Gmail / Google Workspace app password, Resend, a mail server…):
        SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, optional EMAIL_FROM */
import nodemailer from 'nodemailer';

export interface MailMessage { to: string[]; cc?: string[]; subject: string; text: string; replyTo?: string }
export interface Mailer {
  /** Human-readable description of the sending account, or null when not configured. */
  from: string | null;
  send(msg: MailMessage): Promise<void>;
}

const notConfigured: Mailer = {
  from: null,
  send: async () => {
    throw new Error('Email is not set up yet: an admin needs to add the Microsoft 365 (MS_*) or SMTP (SMTP_*) settings to the server.');
  },
};

export function createMailer(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Mailer {
  if (env.MS_TENANT_ID || env.MS_CLIENT_ID || env.MS_CLIENT_SECRET || env.MS_SENDER) return graphMailer(env, fetchImpl);
  return smtpMailer(env);
}

export function smtpMailer(env: NodeJS.ProcessEnv = process.env): Mailer {
  const host = env.SMTP_HOST;
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASS;
  const from = env.EMAIL_FROM || user || null;
  if (!host || !user || !pass || !from) return notConfigured;
  const port = Number(env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  return {
    from,
    async send(msg) {
      await transport.sendMail({ from, to: msg.to, cc: msg.cc, subject: msg.subject, text: msg.text, replyTo: msg.replyTo });
    },
  };
}

/** Microsoft Graph `sendMail` with the client-credentials flow (app-only, no user password). */
export function graphMailer(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch): Mailer {
  const tenant = env.MS_TENANT_ID?.trim();
  const clientId = env.MS_CLIENT_ID?.trim();
  const secret = env.MS_CLIENT_SECRET?.trim();
  const sender = env.MS_SENDER?.trim();
  if (!tenant || !clientId || !secret || !sender) {
    return {
      from: null,
      send: async () => { throw new Error('Microsoft 365 email is only partly set up: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET and MS_SENDER are all required.'); },
    };
  }
  let token: { value: string; expires: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.expires > Date.now() + 60_000) return token.value;
    const res = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(tenant!)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId!, client_secret: secret!, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !data.access_token) {
      throw new Error('Microsoft sign-in failed — check MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET (secrets expire). ' + (data.error_description?.split('\r\n')[0] ?? `HTTP ${res.status}`));
    }
    token = { value: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return token.value;
  }

  const recipients = (list: string[] = []) => list.map((address) => ({ emailAddress: { address } }));
  return {
    from: `${sender} (Microsoft 365)`,
    async send(msg) {
      const res = await fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject: msg.subject,
            body: { contentType: 'Text', content: msg.text },
            toRecipients: recipients(msg.to),
            ccRecipients: recipients(msg.cc),
            ...(msg.replyTo ? { replyTo: recipients([msg.replyTo]) } : {}),
          },
          saveToSentItems: true,
        }),
      });
      if (res.status === 202) return;
      const err = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      const hint = res.status === 403 ? ' — the app needs the Mail.Send application permission with admin consent, and access to this mailbox.'
        : res.status === 404 ? ` — no mailbox called ${sender} was found (check MS_SENDER).` : '';
      throw new Error(`Microsoft 365 rejected the email (${err.error?.code ?? res.status})${hint}`);
    },
  };
}
