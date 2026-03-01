import { NotifyEvent, NotifySeverity, EVENT_SEVERITY } from '../notifications/types';

// We need to test the NotificationService class directly, so we'll import the module
// and manipulate the singleton
let notifierModule: typeof import('../notifications/notify');

// Mock nodemailer so no real emails are sent
const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'test-id' });
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
  createTestAccount: jest.fn().mockResolvedValue({ user: 'test', pass: 'test' }),
  getTestMessageUrl: jest.fn(() => 'https://ethereal.email/message/test'),
}));

jest.mock('../notifications/email-transport', () => ({
  createTransport: jest.fn().mockResolvedValue({ sendMail: mockSendMail }),
}));

beforeAll(() => {
  process.env.ADMIN_NOTIFY_EMAIL = 'admin@test.com';
});

beforeEach(() => {
  jest.clearAllMocks();
  // Re-import to get fresh singleton each time
  jest.isolateModules(() => {
    notifierModule = require('../notifications/notify');
  });
});

afterAll(() => {
  delete process.env.ADMIN_NOTIFY_EMAIL;
});

describe('NotificationService', () => {
  test('CRITICAL emit sends email immediately', async () => {
    const { notifier } = notifierModule;
    // Manually set up transport since we're not calling start()
    notifier._setTransport({ sendMail: mockSendMail } as any);

    notifier.emit(NotifyEvent.UNHANDLED_ERROR, 'Test critical error', 'details here', new Error('boom'));

    // sendImmediate is async, give it a tick
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const call = mockSendMail.mock.calls[0][0];
    expect(call.subject).toContain('[Caleo CRITICAL]');
    expect(call.subject).toContain('UNHANDLED_ERROR');
    expect(call.to).toBe('admin@test.com');
    expect(call.html).toContain('boom');
  });

  test('WARNING emit queues for hourly digest, not sent immediately', async () => {
    const { notifier } = notifierModule;
    notifier._setTransport({ sendMail: mockSendMail } as any);

    notifier.emit(NotifyEvent.PROVIDER_BUILD_FAILURE, 'Google failed');

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockSendMail).not.toHaveBeenCalled();
    expect(notifier._getHourlyQueue()).toHaveLength(1);
    expect(notifier._getHourlyQueue()[0].event).toBe(NotifyEvent.PROVIDER_BUILD_FAILURE);
  });

  test('INFO emit queues for daily digest', async () => {
    const { notifier } = notifierModule;
    notifier._setTransport({ sendMail: mockSendMail } as any);

    notifier.emit(NotifyEvent.DAILY_USAGE_STATS, 'Stats for today');

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockSendMail).not.toHaveBeenCalled();
    expect(notifier._getDailyQueue()).toHaveLength(1);
  });

  test('flushHourlyDigest sends batched email', async () => {
    const { notifier } = notifierModule;
    notifier._setTransport({ sendMail: mockSendMail } as any);

    notifier.emit(NotifyEvent.RATE_LIMIT_HIT, 'User xyz rate limited');
    notifier.emit(NotifyEvent.NEW_USER_SIGNUP, 'New user connected Google');
    notifier.emit(NotifyEvent.BILLING_PAYMENT, '$5 payment received');

    expect(mockSendMail).not.toHaveBeenCalled();

    await notifier.flushHourlyDigest();

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const call = mockSendMail.mock.calls[0][0];
    expect(call.subject).toContain('Hourly digest');
    expect(call.subject).toContain('3 events');
    expect(call.html).toContain('RATE_LIMIT_HIT');
    expect(call.html).toContain('NEW_USER_SIGNUP');
    expect(call.html).toContain('BILLING_PAYMENT');

    // Queue should be empty after flush
    expect(notifier._getHourlyQueue()).toHaveLength(0);
  });

  test('flushHourlyDigest does nothing when queue is empty', async () => {
    const { notifier } = notifierModule;
    notifier._setTransport({ sendMail: mockSendMail } as any);

    await notifier.flushHourlyDigest();

    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('emit() never throws even when sendMail rejects', async () => {
    const failingSendMail = jest.fn().mockRejectedValue(new Error('SMTP down'));
    const { notifier } = notifierModule;
    notifier._setTransport({ sendMail: failingSendMail } as any);

    // Should not throw
    expect(() => {
      notifier.emit(NotifyEvent.UNHANDLED_ERROR, 'Test error');
    }).not.toThrow();

    await new Promise(resolve => setTimeout(resolve, 10));
    // sendMail was called but failed — no exception propagated
    expect(failingSendMail).toHaveBeenCalledTimes(1);
  });

  test('dedup: same critical error twice within 5 min sends only 1 email', async () => {
    const { notifier } = notifierModule;
    notifier._setTransport({ sendMail: mockSendMail } as any);

    notifier.emit(NotifyEvent.DB_CONNECTION_FAILURE, 'Connection lost');
    notifier.emit(NotifyEvent.DB_CONNECTION_FAILURE, 'Connection lost');

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  test('dedup: different messages are not deduped', async () => {
    const { notifier } = notifierModule;
    notifier._setTransport({ sendMail: mockSendMail } as any);

    notifier.emit(NotifyEvent.DB_CONNECTION_FAILURE, 'Connection lost');
    notifier.emit(NotifyEvent.DB_CONNECTION_FAILURE, 'Timeout error');

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockSendMail).toHaveBeenCalledTimes(2);
  });

  test('service is no-op when ADMIN_NOTIFY_EMAIL not set', () => {
    const origEmail = process.env.ADMIN_NOTIFY_EMAIL;
    delete process.env.ADMIN_NOTIFY_EMAIL;

    let freshModule: typeof import('../notifications/notify');
    jest.isolateModules(() => {
      freshModule = require('../notifications/notify');
    });

    const { notifier: disabledNotifier } = freshModule!;
    disabledNotifier._setTransport({ sendMail: mockSendMail } as any);

    disabledNotifier.emit(NotifyEvent.UNHANDLED_ERROR, 'Should be ignored');

    expect(mockSendMail).not.toHaveBeenCalled();
    expect(disabledNotifier._getHourlyQueue()).toHaveLength(0);

    process.env.ADMIN_NOTIFY_EMAIL = origEmail;
  });

  test('EVENT_SEVERITY maps all events correctly', () => {
    // Verify all NotifyEvent values have a severity
    for (const event of Object.values(NotifyEvent)) {
      expect(EVENT_SEVERITY[event]).toBeDefined();
      expect([NotifySeverity.CRITICAL, NotifySeverity.WARNING, NotifySeverity.INFO]).toContain(EVENT_SEVERITY[event]);
    }
  });

  test('flushDailyDigest sends and clears daily queue', async () => {
    const { notifier } = notifierModule;
    notifier._setTransport({ sendMail: mockSendMail } as any);

    notifier.emit(NotifyEvent.DAILY_USAGE_STATS, 'Daily stats');

    await notifier.flushDailyDigest();

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const call = mockSendMail.mock.calls[0][0];
    expect(call.subject).toContain('Daily digest');
    expect(notifier._getDailyQueue()).toHaveLength(0);
  });
});
