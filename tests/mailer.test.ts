import { describe, expect, it } from 'vitest';
import { createMailer } from '../server/mailer';

const env = { MS_TENANT_ID: 'tenant-1', MS_CLIENT_ID: 'client-1', MS_CLIENT_SECRET: 'secret-1', MS_SENDER: 'eeos@tbc.test' };

function fakeFetch(handlers: { token?: () => Response; send?: (body: any) => Response }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.includes('login.microsoftonline.com')) return handlers.token?.() ?? new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    return handlers.send?.(JSON.parse(String(init.body))) ?? new Response(null, { status: 202 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('Microsoft 365 (Graph) mailer', () => {
  it('signs in with client credentials and sends through Graph', async () => {
    const { fn, calls } = fakeFetch({});
    const m = createMailer(env, fn);
    expect(m.from).toBe('eeos@tbc.test (Microsoft 365)');
    await m.send({ to: ['a@tbc.test', 'b@tbc.test'], cc: ['pmo@tbc.test'], subject: 'S', text: 'Hello team,\nLine', replyTo: 'me@tbc.test' });
    await m.send({ to: ['a@tbc.test'], subject: 'S2', text: 'x' });
    // token fetched once and reused
    expect(calls.filter((c) => c.url.includes('login.microsoftonline.com'))).toHaveLength(1);
    const tokenBody = new URLSearchParams(String(calls[0].init.body));
    expect(calls[0].url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
    expect(Object.fromEntries(tokenBody)).toEqual({ client_id: 'client-1', client_secret: 'secret-1', scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
    expect(calls[1].url).toBe('https://graph.microsoft.com/v1.0/users/eeos%40tbc.test/sendMail');
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      message: {
        subject: 'S', body: { contentType: 'Text', content: 'Hello team,\nLine' },
        toRecipients: [{ emailAddress: { address: 'a@tbc.test' } }, { emailAddress: { address: 'b@tbc.test' } }],
        ccRecipients: [{ emailAddress: { address: 'pmo@tbc.test' } }],
        replyTo: [{ emailAddress: { address: 'me@tbc.test' } }],
      },
      saveToSentItems: true,
    });
  });

  it('can send from another mailbox, e.g. the planning mailbox', async () => {
    const { fn, calls } = fakeFetch({});
    await createMailer(env, fn).send({ to: ['a@tbc.test'], subject: 's', text: 't', from: 'planning@tbc.test' });
    expect(calls[1].url).toBe('https://graph.microsoft.com/v1.0/users/planning%40tbc.test/sendMail');
  });

  it('explains common setup problems', async () => {
    const badSecret = fakeFetch({ token: () => new Response(JSON.stringify({ error_description: 'AADSTS7000222: The provided client secret keys are expired.\r\nTrace ID: x' }), { status: 401 }) });
    await expect(createMailer(env, badSecret.fn).send({ to: ['a@tbc.test'], subject: 's', text: 't' })).rejects.toThrow(/secrets expire\). AADSTS7000222: The provided client secret keys are expired\.$/);
    const noPermission = fakeFetch({ send: () => new Response(JSON.stringify({ error: { code: 'ErrorAccessDenied' } }), { status: 403 }) });
    await expect(createMailer(env, noPermission.fn).send({ to: ['a@tbc.test'], subject: 's', text: 't' })).rejects.toThrow(/ErrorAccessDenied.*Mail\.Send application permission/);
    const partial = createMailer({ MS_TENANT_ID: 't' });
    expect(partial.from).toBeNull();
    await expect(partial.send({ to: ['a@tbc.test'], subject: 's', text: 't' })).rejects.toThrow(/all required/);
  });

  it('falls back to SMTP settings, and reports when nothing is set up', () => {
    expect(createMailer({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u@example.com', SMTP_PASS: 'p' }).from).toBe('u@example.com');
    expect(createMailer({}).from).toBeNull();
  });
});
