export enum NotifySeverity {
  CRITICAL = 'CRITICAL',
  WARNING = 'WARNING',
  INFO = 'INFO',
}

export enum NotifyEvent {
  // CRITICAL — sent immediately
  UNHANDLED_ERROR = 'UNHANDLED_ERROR',
  OAUTH_CALLBACK_FAILURE = 'OAUTH_CALLBACK_FAILURE',
  STRIPE_WEBHOOK_ERROR = 'STRIPE_WEBHOOK_ERROR',
  BOT_STARTUP_FAILURE = 'BOT_STARTUP_FAILURE',
  DB_CONNECTION_FAILURE = 'DB_CONNECTION_FAILURE',

  // WARNING — hourly batch
  PROVIDER_BUILD_FAILURE = 'PROVIDER_BUILD_FAILURE',
  NEW_USER_SIGNUP = 'NEW_USER_SIGNUP',
  TOKEN_EXPIRY_WARNING = 'TOKEN_EXPIRY_WARNING',
  BILLING_LOW_BALANCE = 'BILLING_LOW_BALANCE',
  BILLING_PAYMENT = 'BILLING_PAYMENT',
  RATE_LIMIT_HIT = 'RATE_LIMIT_HIT',

  // INFO — daily digest
  DAILY_USAGE_STATS = 'DAILY_USAGE_STATS',
}

export const EVENT_SEVERITY: Record<NotifyEvent, NotifySeverity> = {
  [NotifyEvent.UNHANDLED_ERROR]: NotifySeverity.CRITICAL,
  [NotifyEvent.OAUTH_CALLBACK_FAILURE]: NotifySeverity.CRITICAL,
  [NotifyEvent.STRIPE_WEBHOOK_ERROR]: NotifySeverity.CRITICAL,
  [NotifyEvent.BOT_STARTUP_FAILURE]: NotifySeverity.CRITICAL,
  [NotifyEvent.DB_CONNECTION_FAILURE]: NotifySeverity.CRITICAL,

  [NotifyEvent.PROVIDER_BUILD_FAILURE]: NotifySeverity.WARNING,
  [NotifyEvent.NEW_USER_SIGNUP]: NotifySeverity.WARNING,
  [NotifyEvent.TOKEN_EXPIRY_WARNING]: NotifySeverity.WARNING,
  [NotifyEvent.BILLING_LOW_BALANCE]: NotifySeverity.WARNING,
  [NotifyEvent.BILLING_PAYMENT]: NotifySeverity.WARNING,
  [NotifyEvent.RATE_LIMIT_HIT]: NotifySeverity.WARNING,

  [NotifyEvent.DAILY_USAGE_STATS]: NotifySeverity.INFO,
};

export interface NotifyItem {
  event: NotifyEvent;
  severity: NotifySeverity;
  message: string;
  details?: string;
  error?: Error;
  timestamp: Date;
}
