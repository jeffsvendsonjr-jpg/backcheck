# Backcheck

## Overview
A time-based automation that monitors published Replit apps for liveness. It periodically checks configured URLs, compiles a status report, and sends email notifications when apps go down or confirms all apps are healthy. Supports dual content scanning: "biotics" (healthy signals that should be present) and "warnings" (bad signals that should not be present). Includes SSL certificate expiration checking, retry-before-alert logic, slow response detection, alert-only mode, and email delivery verification.

## Recent Changes
- 2026-02-26: Added Weekly Pulse email — a trust-building summary sent once per week with total check count, issues detected, and downtime incidents. Sent even in alert-only mode. Uses `backcheck_pulse` table for state.
- 2026-02-25: Renamed product from "I Got Your Back" / "App Monitor" to "Backcheck"
- 2026-02-25: Added SSL certificate expiration checking (14-day warning threshold) and alert-only notification mode
- 2026-02-25: Hardening pass — added retry logic (1 retry with 3s delay before declaring down), slow response detection (>5s threshold), safe URL parsing, empty URL list guard, email send verification
- 2026-02-25: Updated agent instructions with expo positioning and slow response awareness
- 2026-02-25: Added page change detection (content hashing), consecutive slow threshold (2+ checks), alert tone escalation (calm → urgent → brief), grouped failure detection
- 2026-02-11: Added dual content scanning — biotics (+) for healthy signals that must be present, warnings (-) for bad signals that must be absent
- 2026-02-11: Added "watch word" support — per-URL keyword detection (multiple words via semicolon) that triggers warnings even when the app returns 200 OK
- 2026-02-10: Initial build of the monitoring automation

## Project Architecture

### Trigger
- **Type**: Time-based (cron)
- **Schedule**: Every hour (`0 * * * *`), configurable via `SCHEDULE_CRON_EXPRESSION` env var
- **Engine**: Inngest

### Workflow: `app-monitor-workflow`
1. **collect-app-pay-urls** - Reads `APP_URLS` env var (comma-separated, format: `Name|URL|+biotic;-warning`). Gracefully skips malformed entries.
2. **verify-app-liveness** (forEach, concurrency: 5) - HTTP GET check for each URL + optional content scan for biotics and warnings. Retries once with 3s delay before declaring down. Tracks consecutive slow responses (flags after 2+). Checks SSL certificate expiration (warns at 14 days). Computes content hash for change detection. Persists state to database.
3. **compile-verification-report** - Aggregates results into healthy/down/issue lists. Detects grouped failures (2+ apps down simultaneously). Determines alert tone based on consecutive failure count. Returns hasProblems=true if 0 apps were checked.
4. **Branch**:
   - If any apps are down or have content issues → `notify-non-live-apps` (agent sends tone-appropriate alert email, verifies delivery)
   - If all apps are live and healthy → `confirm-all-apps-live` (agent sends confirmation email, verifies delivery; skipped in alert-only mode)

### Agent: `monitorAgent` (Backcheck Agent)
- Model: GPT-4o via Replit AI Integrations
- Tools: `checkUrlTool`, `sendEmailTool`
- Instructions: Expo positioning — preventative monitoring, not diagnostic. Aware of SSL, slow response, biotics, warnings, content changes, grouped failures, and tone escalation.
- Used in notification steps to craft tone-appropriate email content

### Key Files
- `src/mastra/workflows/monitorWorkflow.ts` - Main workflow with all monitoring logic
- `src/mastra/agents/monitorAgent.ts` - Agent definition
- `src/mastra/tools/checkUrlTool.ts` - URL liveness checker (standalone tool for agent use)
- `src/mastra/tools/sendEmailTool.ts` - Email sender via Replit Mail
- `src/utils/replitmail.ts` - Replit Mail utility (from blueprint)
- `src/utils/appState.ts` - Database state persistence (content hashes, failure counts)
- `src/mastra/index.ts` - Registration and cron trigger setup

### Database
- **Table**: `backcheck_app_state` - Tracks per-URL monitoring state
  - `url` (TEXT, PK) - The monitored URL
  - `content_hash` (TEXT) - MD5 hash of last seen page content
  - `consecutive_failures` (INTEGER) - Count of consecutive check failures
  - `consecutive_slow` (INTEGER) - Count of consecutive slow responses
  - `last_status` (TEXT) - Last check result: "healthy", "issues", or "down"
  - `updated_at` (TIMESTAMP) - Last state update time
- **Table**: `backcheck_pulse` - Weekly pulse email tracking (single row, id=1)
  - `id` (INTEGER, PK, CHECK id=1) - Always 1
  - `total_checks` (INTEGER) - Checks performed since last pulse
  - `total_issues` (INTEGER) - Issues detected since last pulse
  - `total_down` (INTEGER) - Downtime incidents since last pulse
  - `week_start` (TIMESTAMP) - Start of current tracking period
  - `last_pulse_sent` (TIMESTAMP) - When last pulse email was sent

### Environment Variables
- `APP_URLS` - Comma-separated list of URLs to monitor. Format: `Name|URL|signals`, `Name|URL`, or just `URL`. Signals use semicolons to separate multiple entries. Prefix with `+` for biotics (healthy signals that SHOULD be present) or `-` for warnings (bad signals that SHOULD NOT be present). Unprefixed words default to warnings. Example: `My App|https://myapp.replit.app|+welcome;+operational;-error;-maintenance`
- `SCHEDULE_CRON_EXPRESSION` - Cron expression override (default: `0 * * * *`)
- `NOTIFY_MODE` - Set to `alert-only` to only receive emails when something is wrong. Default: `all` (sends both alerts and healthy confirmations)

### Monitoring Features
- **Page change detection**: Hashes page content (MD5) and compares between checks. Alerts when content changes significantly — catches accidental deploys, hacked pages, or wrong environments shipped.
- **Alert tone escalation**: First failure = calm diagnostic. 2-3 consecutive = urgent. 4+ consecutive = brief status update. Prevents alert fatigue.
- **Consecutive slow threshold**: Only flags slow responses after 2+ consecutive slow checks (>5000ms). Single spikes are ignored to reduce noise.
- **Grouped failure detection**: When 2+ apps fail in the same cycle, notes "possible shared dependency issue" in the alert. Sends one email, not multiple.
- **SSL certificate checking**: Checks HTTPS certificate expiration via TLS handshake. Warns when cert expires within 14 days. Reports days remaining for all apps.
- **Retry before alert**: Failed checks are retried once after 3 seconds to prevent false alarms from transient network issues
- **Dual content scanning**: Biotics (+) for required healthy signals, Warnings (-) for prohibited bad signals
- **Alert-only mode**: Set `NOTIFY_MODE=alert-only` to skip "all healthy" confirmation emails
- **Safe URL parsing**: Malformed entries are logged and skipped instead of crashing
- **Empty list guard**: Reports hasProblems=true when 0 apps are checked (prevents false "all healthy" emails)
- **Email delivery verification**: After agent sends email, tool results are inspected to confirm delivery succeeded
- **State persistence**: Per-URL state stored in PostgreSQL for cross-check memory (content hashes, failure counts, slow counts)
- **Weekly Pulse email**: Once per week, sends a short trust-building email: total checks performed, issues detected, downtime incidents. Proves the tool is alive during quiet weeks. Sent even in alert-only mode. Sign-off: "Silence is healthy. —Backcheck"

## User Preferences
- Agent-centric approach preferred over front-facing web UI
- Product positioning: preventative tool ("expo" at the pass), not diagnostic
- Target market: solo devs, freelancers/agencies, small SaaS, e-commerce operators
