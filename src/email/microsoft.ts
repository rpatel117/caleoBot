import { EmailProvider, EmailDraft, CreateDraftParams } from './types';

const BASE_URL = 'https://graph.microsoft.com/v1.0';

export class MicrosoftEmailProvider implements EmailProvider {
  async createDraft(accessToken: string, params: CreateDraftParams): Promise<EmailDraft> {
    const body = {
      subject: params.subject,
      body: {
        contentType: 'html',
        content: params.body.replace(/\n/g, '<br>'),
      },
      toRecipients: params.toRecipients.map(email => ({
        emailAddress: { address: email },
      })),
      isDraft: true,
    };

    const response = await fetch(`${BASE_URL}/me/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Outlook draft creation failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;

    return {
      id: data.id,
      webLink: data.webLink,
      subject: data.subject,
      toRecipients: params.toRecipients,
    };
  }
}
