export function getHomepageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Backcheck — Your apps are running. Are they working?</title>
  <meta name="description" content="Silent monitoring for published apps. Backcheck watches what your users see, not just what your server returns.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg: #0a0a0b;
      --surface: #141416;
      --border: #1e1e22;
      --text: #e4e4e7;
      --text-muted: #71717a;
      --accent: #22c55e;
      --accent-dim: rgba(34, 197, 94, 0.12);
      --red: #ef4444;
      --amber: #f59e0b;
    }

    body {
      font-family: 'Inter', -apple-system, system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }

    .container {
      max-width: 720px;
      margin: 0 auto;
      padding: 0 24px;
    }

    nav {
      padding: 24px 0;
      border-bottom: 1px solid var(--border);
    }

    nav .container {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .logo {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text);
    }

    .logo span {
      color: var(--accent);
    }

    .nav-status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--text-muted);
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      background: var(--accent);
      border-radius: 50%;
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.85); }
    }

    .hero {
      padding: 100px 0 80px;
      text-align: center;
    }

    .hero h1 {
      font-size: clamp(32px, 6vw, 52px);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.1;
      margin-bottom: 24px;
    }

    .hero h1 em {
      font-style: normal;
      color: var(--accent);
    }

    .hero p {
      font-size: 18px;
      color: var(--text-muted);
      max-width: 520px;
      margin: 0 auto 40px;
      line-height: 1.7;
    }

    .hook {
      display: inline-block;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 100px;
      padding: 10px 24px;
      font-size: 14px;
      color: var(--text-muted);
      margin-bottom: 32px;
    }

    .hook strong {
      color: var(--text);
    }

    section {
      padding: 60px 0;
    }

    .section-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--accent);
      margin-bottom: 12px;
    }

    section h2 {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 16px;
    }

    section > .container > p {
      color: var(--text-muted);
      margin-bottom: 40px;
      font-size: 16px;
    }

    .problem-grid {
      display: grid;
      gap: 16px;
    }

    .problem-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
    }

    .problem-card .status-line {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 14px;
    }

    .status-green { color: var(--accent); }
    .status-red { color: var(--red); }
    .status-amber { color: var(--amber); }

    .problem-card p {
      color: var(--text-muted);
      font-size: 14px;
      line-height: 1.6;
    }

    .features-list {
      display: grid;
      gap: 2px;
    }

    .feature-row {
      display: grid;
      grid-template-columns: 200px 1fr;
      gap: 24px;
      padding: 20px 0;
      border-bottom: 1px solid var(--border);
    }

    .feature-row:last-child {
      border-bottom: none;
    }

    .feature-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
    }

    .feature-desc {
      font-size: 14px;
      color: var(--text-muted);
      line-height: 1.6;
    }

    .how-section {
      border-top: 1px solid var(--border);
    }

    .config-block {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
      overflow-x: auto;
    }

    .config-block code {
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 14px;
      color: var(--accent);
      line-height: 1.8;
      white-space: pre;
    }

    .config-block .comment {
      color: var(--text-muted);
    }

    .steps {
      display: grid;
      gap: 24px;
      margin-top: 32px;
    }

    .step {
      display: flex;
      gap: 16px;
      align-items: flex-start;
    }

    .step-num {
      width: 32px;
      height: 32px;
      min-width: 32px;
      background: var(--accent-dim);
      color: var(--accent);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 700;
    }

    .step-text h3 {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .step-text p {
      font-size: 14px;
      color: var(--text-muted);
    }

    .philosophy {
      border-top: 1px solid var(--border);
    }

    .quote {
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.4;
      margin-bottom: 16px;
    }

    .quote-attr {
      font-size: 14px;
      color: var(--text-muted);
    }

    .not-list {
      margin-top: 40px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    .not-item {
      font-size: 14px;
      padding: 12px 16px;
      border-radius: 8px;
    }

    .not-item.yes {
      background: rgba(34, 197, 94, 0.08);
      color: var(--accent);
    }

    .not-item.no {
      background: rgba(239, 68, 68, 0.08);
      color: var(--text-muted);
      text-decoration: line-through;
      text-decoration-color: rgba(239, 68, 68, 0.4);
    }

    footer {
      border-top: 1px solid var(--border);
      padding: 40px 0;
      text-align: center;
    }

    footer p {
      font-size: 14px;
      color: var(--text-muted);
      line-height: 1.8;
    }

    footer .footer-tagline {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 16px;
      opacity: 0.6;
    }

    .chat-toggle {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 56px;
      height: 56px;
      background: var(--accent);
      border: none;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 24px rgba(34, 197, 94, 0.3);
      transition: transform 0.2s, box-shadow 0.2s;
      z-index: 1000;
    }

    .chat-toggle:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 32px rgba(34, 197, 94, 0.4);
    }

    .chat-toggle svg {
      width: 24px;
      height: 24px;
      fill: var(--bg);
    }

    .chat-panel {
      position: fixed;
      bottom: 92px;
      right: 24px;
      width: 380px;
      max-height: 520px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      display: none;
      flex-direction: column;
      z-index: 999;
      box-shadow: 0 8px 48px rgba(0, 0, 0, 0.5);
      overflow: hidden;
    }

    .chat-panel.open {
      display: flex;
    }

    .chat-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .chat-header .pulse-dot {
      width: 8px;
      height: 8px;
    }

    .chat-header-text {
      font-size: 14px;
      font-weight: 600;
    }

    .chat-header-sub {
      font-size: 12px;
      color: var(--text-muted);
      margin-left: auto;
    }

    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: 300px;
      max-height: 360px;
    }

    .chat-msg {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.5;
      word-wrap: break-word;
    }

    .chat-msg.assistant {
      align-self: flex-start;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
    }

    .chat-msg.user {
      align-self: flex-end;
      background: var(--accent);
      color: var(--bg);
      font-weight: 500;
    }

    .chat-msg.typing {
      align-self: flex-start;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text-muted);
      font-style: italic;
    }

    .chat-input-area {
      padding: 12px 16px;
      border-top: 1px solid var(--border);
      display: flex;
      gap: 8px;
    }

    .chat-input-area input {
      flex: 1;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 14px;
      color: var(--text);
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      outline: none;
      transition: border-color 0.2s;
    }

    .chat-input-area input:focus {
      border-color: var(--accent);
    }

    .chat-input-area input::placeholder {
      color: var(--text-muted);
    }

    .chat-input-area button {
      background: var(--accent);
      border: none;
      border-radius: 8px;
      padding: 10px 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.2s;
    }

    .chat-input-area button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .chat-input-area button svg {
      width: 16px;
      height: 16px;
      fill: var(--bg);
    }

    .suggested-questions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 0 20px 12px;
    }

    .suggested-q {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 100px;
      padding: 6px 12px;
      font-size: 11px;
      color: var(--text-muted);
      cursor: pointer;
      transition: border-color 0.2s, color 0.2s;
      font-family: 'Inter', sans-serif;
    }

    .suggested-q:hover {
      border-color: var(--accent);
      color: var(--accent);
    }

    @media (max-width: 600px) {
      .hero { padding: 60px 0 50px; }
      .feature-row { grid-template-columns: 1fr; gap: 4px; }
      .not-list { grid-template-columns: 1fr; }
      section { padding: 40px 0; }
      .chat-panel {
        width: calc(100vw - 32px);
        right: 16px;
        bottom: 84px;
        max-height: 70vh;
      }
      .chat-toggle {
        bottom: 16px;
        right: 16px;
      }
    }
  </style>
</head>
<body>

  <nav>
    <div class="container">
      <div class="logo">back<span>check</span></div>
      <div class="nav-right" style="display:flex;align-items:center;gap:20px;">
        <a href="/dashboard" style="font-size:13px;color:var(--text-muted);text-decoration:none;transition:color 0.2s;" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--text-muted)'">Dashboard →</a>
        <div class="nav-status">
          <div class="pulse-dot"></div>
          Monitoring
        </div>
      </div>
    </div>
  </nav>

  <section class="hero">
    <div class="container">
      <div class="hook">Most monitors check if your server responds. <strong>That's not enough.</strong></div>
      <h1>Your apps are running.<br>Are they <em>working</em>?</h1>
      <p>Backcheck watches what your users actually see. It catches the problems that return 200 OK — broken pages, expired certs, missing content, silent failures.</p>
    </div>
  </section>

  <section>
    <div class="container">
      <div class="section-label">The Problem</div>
      <h2>The 200 OK Lie</h2>
      <p>Your server says everything is fine. Your users see something else.</p>

      <div class="problem-grid">
        <div class="problem-card">
          <div class="status-line">
            <span class="status-green">200 OK</span>
            <span style="color: var(--text-muted)">+</span>
            <span class="status-red">Login page shows "undefined"</span>
          </div>
          <p>Your uptime monitor sees a healthy response. Your users see a broken app. Backcheck scans the actual page content and catches this.</p>
        </div>
        <div class="problem-card">
          <div class="status-line">
            <span class="status-green">200 OK</span>
            <span style="color: var(--text-muted)">+</span>
            <span class="status-amber">SSL expires in 3 days</span>
          </div>
          <p>The page loads fine today. In 72 hours, browsers show a security warning and users leave. Backcheck checks your certificate and warns you early.</p>
        </div>
        <div class="problem-card">
          <div class="status-line">
            <span class="status-green">200 OK</span>
            <span style="color: var(--text-muted)">+</span>
            <span class="status-red">Page content changed unexpectedly</span>
          </div>
          <p>Someone deployed the wrong branch. The homepage now shows a staging environment. Backcheck fingerprints your pages and alerts when content changes.</p>
        </div>
      </div>
    </div>
  </section>

  <section>
    <div class="container">
      <div class="section-label">What It Does</div>
      <h2>25 features. Zero dashboards.</h2>
      <p>Every feature exists because of a specific failure mode. Nothing extra.</p>

      <div class="features-list">
        <div class="feature-row">
          <div class="feature-name">Liveness checks</div>
          <div class="feature-desc">Real HTTP requests every hour, the same way a browser would visit your app.</div>
        </div>
        <div class="feature-row">
          <div class="feature-name">Content scanning</div>
          <div class="feature-desc">Biotics (words that should be there) and warnings (words that shouldn't). Catches the 200 OK lie.</div>
        </div>
        <div class="feature-row">
          <div class="feature-name">Page change detection</div>
          <div class="feature-desc">Fingerprints page content between checks. Catches bad deploys, hacked pages, wrong environments.</div>
        </div>
        <div class="feature-row">
          <div class="feature-name">SSL monitoring</div>
          <div class="feature-desc">Checks certificate expiration via TLS handshake. Configurable warning threshold.</div>
        </div>
        <div class="feature-row">
          <div class="feature-name">Slow response tracking</div>
          <div class="feature-desc">Only flags after 2+ consecutive slow checks. Ignores single spikes.</div>
        </div>
        <div class="feature-row">
          <div class="feature-name">Retry before alert</div>
          <div class="feature-desc">Retries once after 3 seconds before declaring anything down. No false alarms from network blips.</div>
        </div>
        <div class="feature-row">
          <div class="feature-name">Alert tone escalation</div>
          <div class="feature-desc">First failure is calm. Repeat failures get urgent. Ongoing issues get brief. Prevents alert fatigue.</div>
        </div>
        <div class="feature-row">
          <div class="feature-name">Grouped failure detection</div>
          <div class="feature-desc">When multiple apps fail together, flags a possible shared dependency issue in one notification.</div>
        </div>
        <div class="feature-row">
          <div class="feature-name">AI-composed emails</div>
          <div class="feature-desc">GPT-4o writes severity-matched notifications. Not templates — real, context-aware messages.</div>
        </div>
        <div class="feature-row">
          <div class="feature-name">Webhook support</div>
          <div class="feature-desc">Slack, Discord, or any HTTP endpoint. Auto-detects platform and formats accordingly.</div>
        </div>
        <div class="feature-row">
          <div class="feature-name">Weekly Pulse</div>
          <div class="feature-desc">Once per week: total checks, issues found, downtime incidents. Proof the tool is alive during quiet weeks.</div>
        </div>
        <div class="feature-row">
          <div class="feature-name">Alert-only mode</div>
          <div class="feature-desc">Only hear from Backcheck when something is wrong. Silence means healthy.</div>
        </div>
      </div>
    </div>
  </section>

  <section class="how-section">
    <div class="container">
      <div class="section-label">How It Works</div>
      <h2>One environment variable. That's the config.</h2>

      <div class="config-block">
        <code><span class="comment"># Add your apps</span>
APP_URLS="My SaaS|https://myapp.com|+welcome;-error,
          Client Site|https://client.com|+portfolio,
          API|https://api.myapp.com"</code>
      </div>

      <div class="steps">
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-text">
            <h3>Set your URLs</h3>
            <p>Name, URL, and optional content signals. One line per app. Comma-separated.</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <div class="step-text">
            <h3>Publish</h3>
            <p>Backcheck runs on a cron schedule. Default: every hour. No servers to manage.</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num">3</div>
          <div class="step-text">
            <h3>Get notified</h3>
            <p>Email, Slack, or Discord. Only when something needs your attention.</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="how-section">
    <div class="container">
      <div class="section-label">Getting Started</div>
      <h2>Up and running in 2 minutes.</h2>
      <p>No accounts, no onboarding flow, no integrations page. Just environment variables.</p>

      <div class="steps">
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-text">
            <h3>Add your apps</h3>
            <p>Set the <code style="color: var(--accent); background: var(--bg); padding: 2px 6px; border-radius: 4px; font-size: 12px;">APP_URLS</code> environment variable. Format:<br>
            <code style="color: var(--text-muted); font-size: 12px;">Name|URL|+biotic;-warning</code></p>
          </div>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <div class="step-text">
            <h3>Choose your notification style</h3>
            <p>Set <code style="color: var(--accent); background: var(--bg); padding: 2px 6px; border-radius: 4px; font-size: 12px;">NOTIFY_MODE=alert-only</code> to only hear when something breaks. Leave it unset for all-clear confirmations too.</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num">3</div>
          <div class="step-text">
            <h3>Optional: Add webhooks</h3>
            <p>Set <code style="color: var(--accent); background: var(--bg); padding: 2px 6px; border-radius: 4px; font-size: 12px;">WEBHOOK_URL</code> to a Slack, Discord, or any HTTP endpoint. Backcheck auto-detects the platform.</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num">4</div>
          <div class="step-text">
            <h3>Publish and forget</h3>
            <p>Backcheck runs every hour by default. Change the schedule with <code style="color: var(--accent); background: var(--bg); padding: 2px 6px; border-radius: 4px; font-size: 12px;">SCHEDULE_CRON_EXPRESSION</code> if you want.</p>
          </div>
        </div>
      </div>

      <div class="config-block" style="margin-top: 32px;">
        <code><span class="comment"># Quick reference: all environment variables</span>

<span class="comment"># Required</span>
APP_URLS="My App|https://myapp.replit.app|+welcome;-error"

<span class="comment"># Optional</span>
NOTIFY_MODE=alert-only          <span class="comment"># or "all" (default)</span>
WEBHOOK_URL=https://hooks.slack.com/...
SSL_WARN_DAYS=14                <span class="comment"># days before cert expiry to warn</span>
SCHEDULE_CRON_EXPRESSION=0 * * * *  <span class="comment"># default: every hour</span></code>
      </div>

      <div class="config-block">
        <code><span class="comment"># APP_URLS format examples</span>

<span class="comment"># Basic: just a URL</span>
https://myapp.replit.app

<span class="comment"># Named: Name|URL</span>
My App|https://myapp.replit.app

<span class="comment"># With content signals: Name|URL|signals</span>
My App|https://myapp.replit.app|+welcome;+login;-error;-maintenance

<span class="comment"># Multiple apps: comma-separated</span>
App 1|https://app1.replit.app|+home,
App 2|https://app2.replit.app|-error,
API|https://api.myapp.com</code>
      </div>

      <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-top: 8px;">
        <div style="font-size: 14px; font-weight: 600; margin-bottom: 12px; color: var(--accent);">What are biotics and warnings?</div>
        <div style="font-size: 14px; color: var(--text-muted); line-height: 1.7;">
          <strong style="color: var(--text);">Biotics (+)</strong> are words that <em>should</em> be on the page. Like vital signs. If "welcome" disappears from your homepage, something is wrong.<br><br>
          <strong style="color: var(--text);">Warnings (-)</strong> are words that <em>should not</em> be on the page. If "error" or "maintenance" shows up, Backcheck catches it even though the server returned 200 OK.
        </div>
      </div>
    </div>
  </section>

  <section class="philosophy">
    <div class="container">
      <div class="section-label">Philosophy</div>
      <div class="quote">"Backcheck watches your apps the way you would — if you had time."</div>
      <p class="quote-attr">Built for solo devs, freelancers, small teams. The people who ship things and move on.</p>

      <div class="not-list">
        <div class="not-item yes">Hourly checks</div>
        <div class="not-item no">Dashboards</div>
        <div class="not-item yes">Email + webhooks</div>
        <div class="not-item no">Login required</div>
        <div class="not-item yes">Content-aware</div>
        <div class="not-item no">Per-feature pricing</div>
        <div class="not-item yes">Alert-only mode</div>
        <div class="not-item no">Alert fatigue</div>
      </div>
    </div>
  </section>

  <footer>
    <div class="container">
      <div class="logo" style="margin-bottom: 16px;">back<span>check</span></div>
      <p>Silent monitoring for published apps.<br>Silence is healthy.</p>
      <p class="footer-tagline">Built on Replit.</p>
    </div>
  </footer>

  <button class="chat-toggle" id="chatToggle" aria-label="Open chat">
    <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/><path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg>
  </button>

  <div class="chat-panel" id="chatPanel">
    <div class="chat-header">
      <div class="pulse-dot"></div>
      <div class="chat-header-text">Backcheck Assistant</div>
      <div class="chat-header-sub">Ask anything</div>
    </div>
    <div class="chat-messages" id="chatMessages">
      <div class="chat-msg assistant">Hey there. I'm Backcheck. Ask me about your app status, how monitoring works, or how to configure things. I got your back.</div>
    </div>
    <div class="suggested-questions" id="suggestedQuestions">
      <button class="suggested-q" data-q="What's the current status of my apps?">App status</button>
      <button class="suggested-q" data-q="How do I add a new app to monitor?">Add an app</button>
      <button class="suggested-q" data-q="What are biotics and warnings?">Biotics?</button>
      <button class="suggested-q" data-q="How does alert-only mode work?">Alert mode</button>
    </div>
    <div class="chat-input-area">
      <input type="text" id="chatInput" placeholder="Ask Backcheck anything..." autocomplete="off">
      <button id="chatSend" aria-label="Send">
        <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
      </button>
    </div>
  </div>

  <script>
    (function() {
      var toggle = document.getElementById('chatToggle');
      var panel = document.getElementById('chatPanel');
      var input = document.getElementById('chatInput');
      var sendBtn = document.getElementById('chatSend');
      var messages = document.getElementById('chatMessages');
      var suggested = document.getElementById('suggestedQuestions');
      var threadId = 'chat-' + Math.random().toString(36).slice(2, 10);
      var resourceId = 'web-visitor';
      var sending = false;

      var API_BASE = window.location.origin;

      toggle.addEventListener('click', function() {
        panel.classList.toggle('open');
        if (panel.classList.contains('open')) {
          input.focus();
        }
      });

      function addMessage(text, role) {
        var div = document.createElement('div');
        div.className = 'chat-msg ' + role;
        div.textContent = text;
        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
        return div;
      }

      function showTyping() {
        var div = document.createElement('div');
        div.className = 'chat-msg typing';
        div.id = 'typingIndicator';
        div.textContent = 'Thinking...';
        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
      }

      function removeTyping() {
        var el = document.getElementById('typingIndicator');
        if (el) el.remove();
      }

      async function sendMessage(text) {
        if (sending || !text.trim()) return;
        sending = true;
        sendBtn.disabled = true;
        input.value = '';

        if (suggested) {
          suggested.style.display = 'none';
        }

        addMessage(text, 'user');
        showTyping();

        try {
          var res = await fetch(API_BASE + '/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [{ role: 'user', content: text }],
              threadId: threadId,
              resourceId: resourceId,
            }),
          });

          removeTyping();

          if (!res.ok) {
            addMessage('Sorry, I had trouble processing that. Try again in a moment.', 'assistant');
            sending = false;
            sendBtn.disabled = false;
            return;
          }

          var data = await res.json();
          var reply = data.text || 'I got your back, but I had nothing specific to say about that.';
          addMessage(reply, 'assistant');
        } catch (err) {
          removeTyping();
          addMessage('Connection issue. Make sure Backcheck is running.', 'assistant');
        }

        sending = false;
        sendBtn.disabled = false;
        input.focus();
      }

      sendBtn.addEventListener('click', function() {
        sendMessage(input.value);
      });

      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          sendMessage(input.value);
        }
      });

      document.querySelectorAll('.suggested-q').forEach(function(btn) {
        btn.addEventListener('click', function() {
          sendMessage(btn.getAttribute('data-q'));
        });
      });
    })();
  </script>

</body>
</html>`;
}
