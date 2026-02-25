# App Monitor - "I Got Your Back"

## Overview
A time-based automation that monitors published Replit apps for liveness. It periodically checks configured URLs, compiles a status report, and sends email notifications when apps go down or confirms all apps are healthy. Supports dual content scanning: "biotics" (healthy signals that should be present) and "warnings" (bad signals that should not be present). Includes retry-before-alert logic to prevent false alarms, slow response detection, and email delivery verification.

## Recent Changes
- 2026-02-25: Hardening pass — added retry logic (1 retry with 3s delay before declaring down), slow response detection (>5s threshold), safe URL parsing, empty URL list guard, email send verification
- 2026-02-25: Updated agent instructions with expo positioning and slow response awareness
- 2026-02-11: Added dual content scanning — biotics (+) for healthy signals that must be present, warnings (-) for bad signals that must be absent
- 2026-02-11: Added "watch word" support — per-URL keyword detection (multiple words via semicolon) that triggers warnings even when the app returns 200 OK
- 2026-02-10: Initial build of the monitoring automation

## Project Architecture

### Trigger
- **Type**: Time-based (cron)
- **Schedule**: Every 6 hours (`0 */6 * * *`), configurable via `SCHEDULE_CRON_EXPRESSION` env var
- **Engine**: Inngest

### Workflow: `app-monitor-workflow`
1. **collect-app-pay-urls** - Reads `APP_URLS` env var (comma-separated, format: `Name|URL|+biotic;-warning`). Gracefully skips malformed entries.
2. **verify-app-liveness** (forEach, concurrency: 5) - HTTP GET check for each URL + optional content scan for biotics and warnings. Retries once with 3s delay before declaring down. Flags responses >5000ms as slow.
3. **compile-verification-report** - Aggregates results into healthy/down/issue lists. Returns hasProblems=true if 0 apps were checked.
4. **Branch**:
   - If any apps are down or have content issues → `notify-non-live-apps` (agent sends alert email, verifies delivery)
   - If all apps are live and healthy → `confirm-all-apps-live` (agent sends confirmation email, verifies delivery)

### Agent: `monitorAgent`
- Model: GPT-4o via Replit AI Integrations
- Tools: `checkUrlTool`, `sendEmailTool`
- Instructions: Expo positioning — preventative monitoring, not diagnostic
- Used in notification steps to craft professional email content

### Key Files
- `src/mastra/workflows/monitorWorkflow.ts` - Main workflow with retry logic, slow detection, email verification
- `src/mastra/agents/monitorAgent.ts` - Agent definition
- `src/mastra/tools/checkUrlTool.ts` - URL liveness checker (standalone tool for agent use)
- `src/mastra/tools/sendEmailTool.ts` - Email sender via Replit Mail
- `src/utils/replitmail.ts` - Replit Mail utility (from blueprint)
- `src/mastra/index.ts` - Registration and cron trigger setup

### Environment Variables
- `APP_URLS` - Comma-separated list of URLs to monitor. Format: `Name|URL|signals`, `Name|URL`, or just `URL`. Signals use semicolons to separate multiple entries. Prefix with `+` for biotics (healthy signals that SHOULD be present) or `-` for warnings (bad signals that SHOULD NOT be present). Unprefixed words default to warnings. Example: `My App|https://myapp.replit.app|+welcome;+operational;-error;-maintenance`
- `SCHEDULE_CRON_EXPRESSION` - Cron expression override (default: `0 */6 * * *`)

### Hardening Features
- **Retry before alert**: Failed checks are retried once after 3 seconds to prevent false alarms from transient network issues
- **Slow response detection**: Responses taking >5000ms are flagged as issues
- **Safe URL parsing**: Malformed entries are logged and skipped instead of crashing
- **Empty list guard**: Reports hasProblems=true when 0 apps are checked (prevents false "all healthy" emails)
- **Email delivery verification**: After agent sends email, tool results are inspected to confirm delivery succeeded

## User Preferences
- Agent-centric approach preferred over front-facing web UI
- Product positioning: preventative tool ("expo" at the pass), not diagnostic
- Target market: solo devs, freelancers/agencies, small SaaS, e-commerce operators
