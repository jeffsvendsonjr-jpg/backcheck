# Backcheck

**Your apps are running. Are they *working*?**

Most uptime monitors check if your server responds. Backcheck checks what your users actually see.

→ **[Live Demo Dashboard](https://13f00adb-c665-4dc6-8256-77dbdf17e39f-00-246grmi79egmd.janeway.replit.dev/dashboard)**

---

## The Problem

Your server returns `200 OK`. Your users see a broken page.

Standard uptime monitors miss this entirely. They ping your server, get a response, and report "all clear." Meanwhile:

- Your login page is showing `undefined`
- Your SSL certificate expires in 3 days
- Someone deployed the wrong branch and your homepage is now a staging environment
- Your app returns 200 but the word "error" is on every page

Backcheck catches all of this.

---

## What Makes It Different

**Biotics and warnings** — not just "is it up?"

Most monitors ask one question: did the server respond? Backcheck asks three:

1. Is the server responding? (standard uptime check)
2. Are the healthy signals present? (*biotics* — words or phrases that should be there)
3. Are any bad signals present? (*warnings* — words that should never appear)

```
My App|https://myapp.replit.app|+welcome;+dashboard;-error;-maintenance
```

If "welcome" disappears from your homepage, that's a flag. If "error" shows up anywhere on the page, that's a flag — even if the server returned 200 OK.

**Content change detection with dampening**

Backcheck fingerprints your normalized page content and tracks changes between checks. When the hash changes, it doesn't immediately alert — it waits for two consecutive checks with the same new hash before flagging. This eliminates false positives from A/B tests, rotating content, and dynamic pages. But it catches real changes: bad deploys, hacked pages, wrong environments shipped.

**Alert tone escalation**

First failure: calm, diagnostic email. "Here's what we found, here's the context."
Repeated failures: urgent. "This has persisted across 3 consecutive checks."
Ongoing: brief. "Still down. Check #7."

Most monitors send the same alarm every time. Backcheck prevents the alert fatigue that makes people mute their monitoring tools.

**SSL certificate monitoring**

Checks certificate expiration via TLS handshake. Configurable warning threshold (default: 14 days before expiry).

**AI-composed notifications**

GPT-4o writes the alert emails. Not templates — real, context-aware messages that match the severity and history of the issue.

---

## How It Works

One environment variable. That's the config.

```bash
APP_URLS="My SaaS|https://myapp.replit.app|+welcome;-error,
          Client Site|https://client.com|+portfolio,
          ShieldVault|https://shieldvault.site|+Shield Vault;-error"
```

Backcheck runs on a cron schedule (default: every hour), checks each URL, and emails you only when something needs your attention.

### All environment variables

```bash
# Required
APP_URLS="Name|URL|+biotic;-warning"   # comma-separated list

# Optional
NOTIFY_MODE=alert-only                  # only email on problems (default: all)
WEBHOOK_URL=https://hooks.slack.com/... # Slack, Discord, or any webhook
SSL_WARN_DAYS=14                        # days before cert expiry to warn
SCHEDULE_CRON_EXPRESSION=0 * * * *      # default: every hour
```

### URL format

```
https://myapp.replit.app                        # just a URL
My App|https://myapp.replit.app                 # named
My App|https://myapp.replit.app|+welcome;-error # with content signals
```

Prefix signals with `+` for biotics (must be present) or `-` for warnings (must not be present).

---

## Features

| Feature | Description |
|---|---|
| Liveness checks | HTTP GET every hour, same as a browser visit |
| Biotics | Required healthy signals — alert if missing |
| Warnings | Prohibited bad signals — alert if found |
| Content change detection | MD5 hash of normalized page content, dampened to 2 consecutive checks |
| SSL monitoring | TLS cert expiration, configurable threshold |
| Slow response tracking | Only flags after 2+ consecutive slow checks (>5s) |
| Retry before alert | One retry with 3s delay before declaring down |
| Alert tone escalation | Calm → urgent → brief based on consecutive failures |
| Grouped failure detection | 2+ apps down = possible shared dependency note |
| AI-composed emails | GPT-4o writes tone-appropriate notifications |
| Webhook support | Slack, Discord, or any HTTP endpoint |
| Alert-only mode | Silence = healthy. Only hear when something breaks. |
| Weekly Pulse | Once/week: total checks, issues, downtime. Proof it's alive. |
| AI Assistant | Chat interface for querying status and getting help |

---

## Demo

**[Open the live dashboard →](https://13f00adb-c665-4dc6-8256-77dbdf17e39f-00-246grmi79egmd.janeway.replit.dev/dashboard)**

The dashboard shows real-time status of all monitored apps, weekly pulse stats, and a "Trigger test failure" button that runs the full monitoring pipeline and sends a real alert email.

---

## The Origin

I built ShieldVault — a Chrome extension for managing credentials — and spent more time worrying about whether it was actually working than building it. Standard uptime monitors told me the server was up. They couldn't tell me if the extension paywall was broken, if the page was showing an error state, or if a bad deploy had shipped the wrong environment.

So I built the tool I needed. Backcheck is what I wish existed when I was shipping ShieldVault.

It's designed for solo devs, freelancers, and small teams — the people who ship things and then have to live with them. It runs in the background, stays quiet when everything is fine, and reaches out when it isn't. That's the whole job.

---

## Architecture

- **Runtime**: [Mastra](https://mastra.ai) on Replit
- **Scheduler**: Inngest (cron-triggered workflow)
- **AI**: OpenAI GPT-4o via Replit AI Integrations
- **Database**: PostgreSQL (Replit managed)
- **Notifications**: Replit Mail + webhooks

### Built with Replit Agent

This project was built collaboratively with Replit Agent — from the initial monitoring workflow through content change detection, alert tone escalation, database state management, the landing page, and the AI chat assistant. The agent handled the TypeScript, the database schema, the normalization logic, and the multi-step Inngest workflow. I handled the product decisions, the positioning, and the testing against real apps.

That split — human judgment on what to build, agent execution on how to build it — is what made a solo build of this scope possible in a buildathon window.

---

*Silence is healthy. —Backcheck*
