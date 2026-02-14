export interface EmailDraft {
  id: string;
  webLink?: string;
  subject: string;
  toRecipients: string[];
}

export interface CreateDraftParams {
  subject: string;
  body: string;
  toRecipients: string[];
}

export interface EmailProvider {
  createDraft(accessToken: string, params: CreateDraftParams): Promise<EmailDraft>;
}
