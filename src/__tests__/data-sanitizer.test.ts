import { DataSanitizer } from '../data-sanitizer';

describe('DataSanitizer', () => {
  describe('stripHtml', () => {
    test('removes HTML tags', () => {
      expect(DataSanitizer.stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
    });

    test('decodes HTML entities', () => {
      expect(DataSanitizer.stripHtml('A &amp; B &lt; C &gt; D &quot;E&quot; F&#39;s')).toBe('A & B < C > D "E" F\'s');
    });

    test('handles &nbsp;', () => {
      expect(DataSanitizer.stripHtml('Hello&nbsp;world')).toBe('Hello world');
    });

    test('collapses whitespace', () => {
      expect(DataSanitizer.stripHtml('  Hello   \n\n  world  ')).toBe('Hello world');
    });

    test('truncates at 200 chars with ellipsis', () => {
      const long = '<p>' + 'x'.repeat(300) + '</p>';
      const result = DataSanitizer.stripHtml(long);
      expect(result.length).toBe(203); // 200 + "..."
      expect(result.endsWith('...')).toBe(true);
    });

    test('handles empty string', () => {
      expect(DataSanitizer.stripHtml('')).toBe('');
    });

    test('handles null-ish input', () => {
      expect(DataSanitizer.stripHtml(null as any)).toBe('');
      expect(DataSanitizer.stripHtml(undefined as any)).toBe('');
    });

    test('handles nested HTML', () => {
      expect(DataSanitizer.stripHtml('<div><ul><li>item</li></ul></div>')).toBe('item');
    });

    // XSS: ensure script tags are stripped
    test('strips script tags', () => {
      const result = DataSanitizer.stripHtml('<script>alert("xss")</script>Hello');
      expect(result).not.toContain('<script>');
      expect(result).toContain('Hello');
    });

    test('strips event handlers', () => {
      const result = DataSanitizer.stripHtml('<img onerror="alert(1)" src="x">');
      expect(result).not.toContain('onerror');
    });
  });

  describe('sanitizeEvents', () => {
    test('maps basic event fields', () => {
      const events = [{
        id: 'evt-1',
        subject: 'Meeting',
        start: { dateTime: '2026-02-28T09:00:00Z' },
        end: { dateTime: '2026-02-28T10:00:00Z' },
      }];
      const result = DataSanitizer.sanitizeEvents(events);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('evt-1');
      expect(result[0].subject).toBe('Meeting');
    });

    test('defaults subject to "No Title"', () => {
      const events = [{ id: '1', start: { dateTime: '2026-01-01T00:00:00Z' }, end: { dateTime: '2026-01-01T01:00:00Z' } }];
      expect(DataSanitizer.sanitizeEvents(events)[0].subject).toBe('No Title');
    });

    test('limits attendees to 5', () => {
      const attendees = Array.from({ length: 10 }, (_, i) => ({
        emailAddress: { address: `user${i}@test.com` },
      }));
      const events = [{
        id: '1', subject: 'Big Meeting',
        start: { dateTime: '2026-01-01T00:00:00Z' },
        end: { dateTime: '2026-01-01T01:00:00Z' },
        attendees,
      }];
      const result = DataSanitizer.sanitizeEvents(events);
      expect(result[0].attendees).toHaveLength(5);
    });

    test('skips "Microsoft Teams Meeting" location', () => {
      const events = [{
        id: '1', subject: 'Test',
        start: { dateTime: '2026-01-01T00:00:00Z' },
        end: { dateTime: '2026-01-01T01:00:00Z' },
        location: { displayName: 'Microsoft Teams Meeting' },
      }];
      expect(DataSanitizer.sanitizeEvents(events)[0].location).toBeUndefined();
    });

    test('includes meaningful location', () => {
      const events = [{
        id: '1', subject: 'Test',
        start: { dateTime: '2026-01-01T00:00:00Z' },
        end: { dateTime: '2026-01-01T01:00:00Z' },
        location: { displayName: 'Conference Room B' },
      }];
      expect(DataSanitizer.sanitizeEvents(events)[0].location).toBe('Conference Room B');
    });

    test('handles empty events array', () => {
      expect(DataSanitizer.sanitizeEvents([])).toEqual([]);
    });
  });

  describe('estimateTokens', () => {
    test('estimates ~4 chars per token', () => {
      const data = { key: 'value' }; // ~15 chars JSON
      const tokens = DataSanitizer.estimateTokens(data);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });

    test('empty object has minimal tokens', () => {
      expect(DataSanitizer.estimateTokens({})).toBeLessThanOrEqual(2);
    });
  });
});
