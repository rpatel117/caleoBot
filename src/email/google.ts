import { EmailProvider, EmailDraft, CreateDraftParams } from './types';

export class GoogleEmailProvider implements EmailProvider {
  async createDraft(accessToken: string, params: CreateDraftParams): Promise<EmailDraft> {
    // Build RFC 2822 message
    const toHeader = params.toRecipients.join(', ');
    const escapeHtml = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const rawMessage = [
      `To: ${toHeader}`,
      `Subject: ${params.subject}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      escapeHtml(params.body).replace(/\n/g, '<br>'),
    ].join('\r\n');

    // Base64url encode the message
    const encoded = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: { raw: encoded },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gmail draft creation failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;

    return {
      id: data.id,
      webLink: `https://mail.google.com/mail/#drafts/${data.message?.id || data.id}`,
      subject: params.subject,
      toRecipients: params.toRecipients,
    };
  }
}
