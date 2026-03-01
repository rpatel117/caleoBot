import { NotifyItem, NotifySeverity } from './types';

const STYLE = `
  body { font-family: -apple-system, sans-serif; color: #333; padding: 20px; }
  .header { padding: 12px 16px; color: #fff; border-radius: 4px 4px 0 0; }
  .critical { background: #c0392b; }
  .warning { background: #e67e22; }
  .info { background: #2980b9; }
  .content { padding: 16px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 4px 4px; }
  .item { margin-bottom: 16px; padding: 12px; background: #f9f9f9; border-left: 3px solid #ddd; }
  .item-critical { border-left-color: #c0392b; }
  .item-warning { border-left-color: #e67e22; }
  .item-info { border-left-color: #2980b9; }
  .timestamp { color: #888; font-size: 12px; }
  pre { background: #f4f4f4; padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 13px; }
  .footer { margin-top: 20px; color: #999; font-size: 12px; }
`;

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatTimestamp(date: Date): string {
  return date.toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'short', timeStyle: 'medium' });
}

function renderItem(item: NotifyItem): string {
  const severityClass = `item-${item.severity.toLowerCase()}`;
  let html = `<div class="item ${severityClass}">`;
  html += `<strong>[${item.event}]</strong> ${escapeHtml(item.message)}`;
  html += `<br><span class="timestamp">${formatTimestamp(item.timestamp)}</span>`;
  if (item.details) {
    html += `<br><small>${escapeHtml(item.details)}</small>`;
  }
  if (item.error) {
    html += `<pre>${escapeHtml(item.error.stack || item.error.message)}</pre>`;
  }
  html += '</div>';
  return html;
}

export function renderImmediateEmail(item: NotifyItem): { subject: string; html: string } {
  const subject = `[Caleo CRITICAL] ${item.event}: ${item.message.slice(0, 80)}`;
  const html = `<!DOCTYPE html><html><head><style>${STYLE}</style></head><body>
    <div class="header critical">Caleo Alert — CRITICAL</div>
    <div class="content">${renderItem(item)}</div>
    <div class="footer">Caleo Bot Notifications</div>
  </body></html>`;
  return { subject, html };
}

export function renderHourlyDigestEmail(items: NotifyItem[]): { subject: string; html: string } {
  const subject = `[Caleo] Hourly digest — ${items.length} event${items.length === 1 ? '' : 's'}`;
  const itemsHtml = items.map(renderItem).join('');
  const html = `<!DOCTYPE html><html><head><style>${STYLE}</style></head><body>
    <div class="header warning">Caleo — Hourly Digest</div>
    <div class="content">${itemsHtml}</div>
    <div class="footer">Caleo Bot Notifications — ${formatTimestamp(new Date())}</div>
  </body></html>`;
  return { subject, html };
}

export function renderDailyDigestEmail(items: NotifyItem[]): { subject: string; html: string } {
  const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago' });
  const subject = `[Caleo] Daily digest — ${today}`;
  const itemsHtml = items.length > 0
    ? items.map(renderItem).join('')
    : '<p>No events recorded today.</p>';
  const html = `<!DOCTYPE html><html><head><style>${STYLE}</style></head><body>
    <div class="header info">Caleo — Daily Digest (${today})</div>
    <div class="content">${itemsHtml}</div>
    <div class="footer">Caleo Bot Notifications</div>
  </body></html>`;
  return { subject, html };
}
