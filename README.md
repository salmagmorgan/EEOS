# EEOS — Engagement Excellence Operating System

The Board Consulting's staffing and engagement command centre: engagement lifecycle and critical-path schedules, live utilization and burnout alerts, team-rotation intelligence, staffing recommendations, hiring forecasts, client relationships, profitability, board-ready reports and an AI Copilot grounded in live data.

This is the production build of the single-file EEOS prototype. It keeps the prototype's screens, rules and look, and replaces its foundations:

| Prototype | This build |
|---|---|
| Everything in one 4,000-line HTML file | React + TypeScript web app, Node/Express API, shared domain engine |
| One shared JSON blob of overrides on hard-coded data | Normalized SQL database — Postgres (e.g. Neon), Turso, or a local SQLite file |
| "Type your name, pick Editor or Viewer" (honour system) | Real accounts: email + password, sessions, **admin / editor / viewer** roles enforced on the server |
| Undo = restore a whole-store snapshot from this browser tab | Every change is audited with before/after; any change can be undone safely from the Audit Trail (or "undo my last change") |
| Polling the whole store every 20 seconds | A tiny version check every 5 seconds; data is refetched only when something changed |
| AI calls from the browser | Server-side Copilot (Anthropic API), streaming, with a fresh data snapshot per question |
| Illustrative random past utilization | Past months computed from real engagement dates; future months projected |

## Quick start

Requires Node.js 20+ (22 recommended).

```bash

npm install
cp .env.example .env      # then set ADMIN_EMAIL / ADMIN_PASSWORD (10+ chars)
npm run dev               # API on :8787, web app on http://localhost:5173
```

On first start an empty database is created, loaded with the **anonymized demo data** (`server/seed/demo-seed.json`), and the admin account from `.env` is created. Sign in with it, then add teammates under **Administration → Settings → Users & access**.

```bash
npm test                  # domain-engine and API tests
npm run build             # type-check, build the web app and the server bundle
npm start                 # production: one process serves the API and the web app on $PORT
```

## Loading your real data

The committed demo seed has every person, client and engagement name replaced, because this repository is public. To load the real data from the prototype:

1. Save the prototype artifact's HTML to a file (it embeds the roster, capacity sheet, client list, open engagements, the 373-row staffing log and a snapshot of the team's shared edits).
2. Convert it:
   ```bash
   npm run import:artifact -- path/to/eeos-artifact.html --out data/real-seed.json
   ```
   If you have a newer export of the prototype's shared store (the `eeos/store` document), add `--store path/to/store.json` to apply it instead of the embedded snapshot.
3. Load it, either with `SEED_PATH=./data/real-seed.json` before the very first start, or into an existing database with `npm run seed -- data/real-seed.json` (see the Vercel section for the production database), or by uploading the file under **Data Management → Backup & restore** (admins).

`data/` is git-ignored, so real data never ends up in the repository.

## Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `./data/eeos.db` | Postgres (`postgres://…`, e.g. Neon), Turso (`libsql://…`), or a local file path. `POSTGRES_URL` / `TURSO_DATABASE_URL` also work |
| `DATABASE_AUTH_TOKEN` | — | Turso auth token. `TURSO_AUTH_TOKEN` also works |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | — | First admin account (only used while no users exist) |
| `SEED_PATH` | demo seed | Loaded into an empty database on first start |
| `ANTHROPIC_API_KEY` | — | Enables the AI Copilot |
| `COPILOT_MODEL` | `claude-opus-5-5` | Model used by the Copilot |
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_SENDER` | — | Microsoft 365 account that sends new-project emails (see below) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | — | Or: any SMTP account |
| `COOKIE_SECURE` | `true` on Vercel | Mark session cookies Secure (set `true` behind any other HTTPS host) |
| `PORT` | `8787` | HTTP port (not used on Vercel) |

More users can also be created from the command line: `npm run create-user -- someone@tbc.com editor "Full Name"` (add `DATABASE_URL`/`DATABASE_AUTH_TOKEN` to target the production database).

## Deploying to Vercel

Vercel runs the web app as static files and the API as one serverless function (`api/index.ts`); `vercel.json` already configures both. Serverless functions have no lasting disk, so the data lives in a hosted database: **Neon Postgres** or **Turso** (both have free tiers and are in Vercel's Storage tab).

1. **Create the database.** In your Vercel project open **Storage → Create Database**, pick **Neon** (Postgres) or **Turso**, and connect it to the project. It adds the connection variables (`DATABASE_URL`, or `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`) for you.
2. **Import the repo** in Vercel (**Add New → Project → salmagmorgan/EEOS**). Leave Framework Preset as **Other**; build settings come from `vercel.json`.
3. **Add environment variables** (Project → Settings → Environment Variables):
   - `ADMIN_EMAIL` and `ADMIN_PASSWORD` (10+ characters) — your first login
   - `ANTHROPIC_API_KEY` to turn on the Copilot (optional)
4. **Deploy** (or Redeploy, so the new variables are picked up). The first request creates the tables, loads the demo data and creates your admin account. Visit `https://<your-app>.vercel.app/api/health` — it should say `{"ok":true}`; if not, it says what's missing.

To load your real data into the hosted database, run from your computer (use the same `DATABASE_URL` Vercel shows; Turso also needs `DATABASE_AUTH_TOKEN`):

```bash
DATABASE_URL='postgres://…' npm run seed -- data/real-seed.json
```

or upload the seed file under **Data Management → Backup & restore** (Vercel limits uploads to about 4.5 MB, plenty for EEOS data).

## New-project emails

When an engagement is created, EEOS emails its leader, members, Operations members and supervisor, with the planning committee in copy, using the template in **Settings → New-project emails** (editable; every `{{field}}` fills in automatically). The email can be switched off per engagement on the New Engagement form, re-sent from the engagement's **📧 Email team** button, and every send is recorded in the Audit Trail. If sending fails, the engagement is still created and the message says why.

Setup, once:

1. **Add each person's work email** under **Data Management → Roster** (or when adding a talent).
2. **Set the planning committee** addresses in **Settings → New-project emails** (admins).
3. **Connect a sending account** — add environment variables in Vercel (Settings → Environment Variables), then redeploy.

**Microsoft 365 (recommended for Microsoft tenants).** Microsoft is retiring password-based SMTP for Microsoft 365 (off by default from the end of December 2026), so EEOS sends through Microsoft Graph instead, with no password stored. A Microsoft 365 / Entra admin does this once:

   1. **entra.microsoft.com → Applications → App registrations → New registration.** Name: `EEOS`; supported account types: *this organizational directory only*; no redirect URI. Register.
   2. On the app's **Overview**, copy the **Application (client) ID** and the **Directory (tenant) ID**.
   3. **API permissions → Add a permission → Microsoft Graph → Application permissions → `Mail.Send` → Add**, then **Grant admin consent**.
   4. **Certificates & secrets → New client secret** (24 months). Copy the secret **Value** straight away — it's shown once. Note the expiry date: make a new secret before it runs out.
   5. Choose the mailbox the emails come from, e.g. a shared mailbox `eeos@theboardconsulting.com`.
   6. Recommended: restrict the app to that one mailbox (Exchange Online *RBAC for Applications*, or an application access policy) — `Mail.Send` otherwise allows sending as any mailbox in the organization.

   Then set `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` and `MS_SENDER` (the mailbox address) in Vercel.

**Any SMTP account** (Gmail / Google Workspace, Resend, a mail server):

| Account | `SMTP_HOST` | `SMTP_PORT` | `SMTP_USER` | `SMTP_PASS` |
|---|---|---|---|---|
| Gmail / Google Workspace | `smtp.gmail.com` | `465` | the full email address | an **app password** (Google Account → Security → 2-Step Verification → App passwords) |
| Resend | `smtp.resend.com` | `465` | `resend` | a Resend API key (the sending domain must be verified in Resend) |

For SMTP, optionally set `EMAIL_FROM` to the name and address people see, e.g. `TBC EEOS <eeos@theboardconsulting.com>`. Use **Send a test to me** in Settings to check it.

## Other hosts

Anywhere that runs Node works too; with a persistent disk you can skip Turso and keep the default local file.

```bash
docker build -t eeos .
docker run -p 8787:8787 -v eeos-data:/data \
  -e ADMIN_EMAIL=you@tbc.com -e ADMIN_PASSWORD='a-long-password' \
  -e COOKIE_SECURE=true -e ANTHROPIC_API_KEY=... eeos
```

## How it is built

```
shared/            Pure TypeScript used by both sides
  constants.ts     Business rules: lifecycle stages & weights, scopes, workload tiers, bands, governance
  schedule.ts      Critical-path schedule, progress, health, priority, CPS CSV parsing
  engine.ts        buildModel(): utilization, status, alerts, recommendations, rotation risk,
                   fresh-team builder, hiring gaps, projections, client stats, Copilot context
  types.ts         Data model
api/index.ts       Vercel serverless entry point
server/
  index.ts         Long-running server entry point (local, Docker)
  bootstrap.ts     Migrations, first-run seed and first admin (runs at every start / cold start)
  db.ts            Schema (migrations), row mapping, seed loading — one interface over Postgres and SQLite/Turso
  auth.ts          scrypt passwords, sessions, role checks, CSRF guard, login throttling
  store.ts         Workspace reads, audited mutations, safe undo, version for change polling
  routes/          auth & users · workspace/audit/exports/backup · entities · copilot
  seed/            demo seed, prototype importer (+ anonymizer), seed & create-user CLIs
client/src/
  lib/             API client, workspace context (live sync), report generators
  components/      Layout, charts, detail modals, UI primitives
  views/           One file per page
tests/             Engine and API tests
```

The web app downloads the whole workspace once (it's small: tens of people, a few hundred engagements and staffing rows) and computes every figure with the same engine the server uses for exports and the Copilot, so the numbers always agree. Every write goes through a validated API endpoint that records an audit entry and bumps the workspace version, which everyone else's browser notices within a few seconds.

### Business rules (unchanged from the prototype)

- **Utilization** = the sum of a person's allocation on each *active* engagement (paused, closed, deleted and historical engagements never count). Allocation comes from the engagement's workload tier — Quick Work 25%, Business as Usual 35%, Heavy & Complex 50% (65% for the lead) — a flat 15% for a supervisor, or a manual override. Bands: Underutilized < 75%, Optimal 75–90%, At Capacity 91–100%, Overutilized > 100%.
- **No assumed timelines.** Stage dates come only from an uploaded CPS (weekly plan); an end date only from the CPS or a date someone actually entered. Engagements with neither show "No CPS uploaded" / "No end date" and count as running until closed.
- **Health** is computed, never stored: Complete (final stage of its scope), Delayed (past its known end), About to Close (final stage, ≤ 14 days left or ≥ 85% elapsed), Just Opened (< 20% elapsed — or, with no time frame, still in the first stage), otherwise Midway. **Priority**: High if delayed or lead-only; Low if just opened; otherwise Medium.
- **Recommendations** score capacity 30%, fair rotation 25%, scope experience 25%, sector experience 20%; directors and Operations are excluded.
- **Hiring gaps** appear for title × department groups averaging ≥ 100% utilization.

These live in `shared/constants.ts` and `shared/engine.ts`; change them there and both the app and the API follow.

### Changes from the prototype worth knowing

- Engagements reference people by ID, so renaming someone no longer breaks their history.
- Engagement details (name, client, dates, scope, notes) are editable after creation.
- Each person's card shows their **project weights**: their allocation on every active project, adding up to their utilization; editors can adjust any weight there.
- The importer drops end dates the prototype estimated (its form silently filled blank end dates with today + 90/75/120 days).
- Paused engagements have their own filter everywhere; deleted ones can be restored from Data Management.
- Hiring Forecast's note now matches its rule (≥ 100%; the prototype's text said 90%).
- Capacity Planner only counts an engagement in months its dates actually overlap.
- Recommendations' "scope experience" looks at all past engagements, not just currently active ones.
