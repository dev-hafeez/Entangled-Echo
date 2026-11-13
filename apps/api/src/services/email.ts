import fs from 'fs';
import path from 'path';
import net from 'net';
import { config } from '../config.js';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  type?: 'weekly_digest' | 'milestone' | 'publish_failure';
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ success: boolean; messageId?: string; error?: string }>;
}

export class MockEmailProvider implements EmailProvider {
  private emailDir: string;

  constructor() {
    this.emailDir = path.join(config.localStorageDir, 'emails');
    if (!fs.existsSync(this.emailDir)) {
      fs.mkdirSync(this.emailDir, { recursive: true });
    }
  }

  async send(message: EmailMessage): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const record = {
      messageId,
      sentAt: new Date().toISOString(),
      to: message.to,
      subject: message.subject,
      type: message.type || 'general',
      text: message.text,
      html: message.html,
    };

    const filePath = path.join(this.emailDir, `${messageId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2));

    console.log(`[MockEmailProvider] Sent email "${message.subject}" to <${message.to}> (saved to ${filePath})`);

    return {
      success: true,
      messageId,
    };
  }
}

export class SmtpEmailProvider implements EmailProvider {
  private host: string;
  private port: number;
  private from: string;

  constructor(options?: { host?: string; port?: number; from?: string }) {
    this.host = options?.host || process.env.SMTP_HOST || '127.0.0.1';
    this.port = options?.port || parseInt(process.env.SMTP_PORT || '1025', 10);
    this.from = options?.from || process.env.EMAIL_FROM || 'noreply@entangled-echo.com';
  }

  async send(message: EmailMessage): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      const socket = net.createConnection(this.port, this.host);
      let step = 0;

      const finish = (success: boolean, err?: string) => {
        if (!socket.destroyed) socket.destroy();
        resolve({ success, messageId, error: err });
      };

      socket.setTimeout(5000);
      socket.on('timeout', () => finish(false, 'SMTP connection timed out'));
      socket.on('error', (err) => finish(false, `SMTP error: ${err.message}`));

      socket.on('data', (data) => {
        const res = data.toString();
        if (step === 0 && res.startsWith('220')) {
          step = 1;
          socket.write(`HELO localhost\r\n`);
        } else if (step === 1 && res.startsWith('250')) {
          step = 2;
          socket.write(`MAIL FROM:<${this.from}>\r\n`);
        } else if (step === 2 && res.startsWith('250')) {
          step = 3;
          socket.write(`RCPT TO:<${message.to}>\r\n`);
        } else if (step === 3 && res.startsWith('250')) {
          step = 4;
          socket.write(`DATA\r\n`);
        } else if (step === 4 && res.startsWith('354')) {
          step = 5;
          const headers = [
            `From: ${this.from}`,
            `To: ${message.to}`,
            `Subject: ${message.subject}`,
            `Message-ID: <${messageId}@entangled-echo.com>`,
            `Date: ${new Date().toUTCString()}`,
            `MIME-Version: 1.0`,
            `Content-Type: text/html; charset=utf-8`,
            ``,
            message.html,
            `\r\n.\r\n`,
          ].join('\r\n');
          socket.write(headers);
        } else if (step === 5 && res.startsWith('250')) {
          step = 6;
          socket.write(`QUIT\r\n`);
          finish(true);
        } else if (res.startsWith('4') || res.startsWith('5')) {
          finish(false, `SMTP rejected command at step ${step}: ${res.trim()}`);
        }
      });
    });
  }
}

export function getEmailProvider(): EmailProvider {
  if (process.env.EMAIL_PROVIDER === 'smtp' || process.env.SMTP_HOST) {
    return new SmtpEmailProvider();
  }
  return new MockEmailProvider();
}

// Global provider instance (defaults to mock per Section 0 Operating Rule 3)
export let emailProvider: EmailProvider = getEmailProvider();

export function setEmailProvider(provider: EmailProvider) {
  emailProvider = provider;
}

/**
 * Generate a clean, minimal HTML Weekly Performance Digest (FR-34)
 */
export function renderWeeklyDigestHtml(params: {
  handle: string;
  followersCount: number;
  totalPosts: number;
  totalLikes: number;
  totalComments: number;
  avgEngagementRate: string;
  topPostCaption?: string;
  topPostLikes?: number;
  milestones?: string[];
}): string {
  const {
    handle,
    followersCount,
    totalPosts,
    totalLikes,
    totalComments,
    avgEngagementRate,
    topPostCaption,
    topPostLikes,
    milestones,
  } = params;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 40px 20px; color: #0f172a; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px; }
    .brand { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 24px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; }
    .title { font-size: 22px; font-weight: 700; margin: 0 0 8px 0; }
    .subtitle { font-size: 13px; color: #64748b; margin-bottom: 24px; }
    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
    .stat-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; }
    .stat-label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; letter-spacing: 0.5px; }
    .stat-val { font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 4px; }
    .highlight { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
    .highlight-title { font-size: 13px; font-weight: 700; color: #166534; margin: 0 0 6px 0; }
    .highlight-desc { font-size: 12px; color: #15803d; line-height: 1.5; margin: 0; }
    .footer { font-size: 11px; color: #94a3b8; text-align: center; margin-top: 32px; border-top: 1px solid #f1f5f9; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">EntangledEcho</div>
    <h1 class="title">Weekly Performance Digest</h1>
    <p class="subtitle">Here is how @${handle} performed over the past 7 days.</p>

    <div class="stats-grid">
      <div class="stat-box">
        <div class="stat-label">Followers</div>
        <div class="stat-val">${followersCount.toLocaleString()}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Avg Engagement</div>
        <div class="stat-val">${avgEngagementRate}%</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Total Likes</div>
        <div class="stat-val">${totalLikes.toLocaleString()}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Total Comments</div>
        <div class="stat-val">${totalComments.toLocaleString()}</div>
      </div>
    </div>

    ${
      topPostCaption
        ? `
    <div class="highlight">
      <div class="highlight-title">Top Performing Post</div>
      <p class="highlight-desc">"${topPostCaption.slice(0, 120)}${topPostCaption.length > 120 ? '...' : ''}" (${topPostLikes?.toLocaleString() || 0} likes)</p>
    </div>
    `
        : ''
    }

    ${
      milestones && milestones.length > 0
        ? `
    <div style="background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <div style="font-size: 13px; font-weight: 700; color: #6b21a8; margin-bottom: 6px;">Milestone Alert</div>
      <p style="font-size: 12px; color: #7e22ce; margin: 0;">${milestones.join('<br>')}</p>
    </div>
    `
        : ''
    }

    <p style="font-size: 12px; color: #475569; line-height: 1.6;">
      Quantum-inspired scheduling has analyzed your latest engagement trends. Visit your AI recommendations page to review upcoming optimized post slots.
    </p>

    <div class="footer">
      Sent by EntangledEcho Notifications • You are receiving this because weekly digests are enabled in your preferences.
    </div>
  </div>
</body>
</html>
  `.trim();
}
