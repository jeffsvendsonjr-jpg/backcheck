# App Monitor - "I Got Your Back"

## Overview
A time-based automation that monitors published Replit apps for liveness. It periodically checks configured URLs, compiles a status report, and sends email notifications when apps go down or confirms all apps are healthy.

## Recent Changes
- 2026-02-11: Added "watch word" support — per-URL keyword detection (multiple words via semicolon) that triggers warnings even when the app returns 200 OK
- 2026-02-10: Initial build of the monitoring automation

## Project Architecture

### Trigger
- **Type**: Time-based (cron)
- **Schedule**: Every 6 hours (`0 */6 * * *`), configurable via `SCHEDULE_CRON_EXPRESSION` env var
- **Engine**: Inngest

### Workflow: `app-monitor-workflow`
1. **collect-app-pay-urls** - Reads `APP_URLS` env var (comma-separated, format: `Name|URL|WatchWord`)
2. **verify-app-liveness** (forEach, concurrency: 5) - HTTP GET check for each URL + optional watch word scan in response body
3. **compile-verification-report** - Aggregates results into live/down/warning lists
4. **Branch**:
   - If any apps are down or have watch word warnings → `notify-non-live-apps` (agent sends alert email)
   - If all apps are live and healthy → `confirm-all-apps-live` (agent sends confirmation email)

### Agent: `monitorAgent`
- Model: GPT-4o via Replit AI Integrations
- Tools: `checkUrlTool`, `sendEmailTool`
- Used in notification steps to craft professional email content

### Key Files
- `src/mastra/workflows/monitorWorkflow.ts` - Main workflow
- `src/mastra/agents/monitorAgent.ts` - Agent definition
- `src/mastra/tools/checkUrlTool.ts` - URL liveness checker
- `src/mastra/tools/sendEmailTool.ts` - Email sender via Replit Mail
- `src/utils/replitmail.ts` - Replit Mail utility (from blueprint)
- `src/mastra/index.ts` - Registration and cron trigger setup

### Environment Variables
- `APP_URLS` - Comma-separated list of URLs to monitor. Format: `Name|URL|WatchWord`, `Name|URL`, or just `URL`. The optional watch word triggers a warning if found in the page content. Multiple watch words can be separated by semicolons (e.g., `Name|URL|error;maintenance;offline`).
- `SCHEDULE_CRON_EXPRESSION` - Cron expression override (default: `0 */6 * * *`)

## User Preferences
- Agent-centric approach preferred over front-facing web UI
