import { maskEmail, toSafeErrorMessage } from './log-redaction.util';

describe('maskEmail', () => {
  it('keeps the first local-part character and the full domain', () => {
    expect(maskEmail('francosebastiangiuliano@gmail.com')).toBe(
      'f***@gmail.com',
    );
  });

  it('handles a single-character local part', () => {
    expect(maskEmail('a@example.com')).toBe('a***@example.com');
  });

  it('returns a fixed placeholder for malformed input without "@"', () => {
    expect(maskEmail('not-an-email')).toBe('***');
  });

  it('returns a fixed placeholder when the local part is empty', () => {
    expect(maskEmail('@example.com')).toBe('***');
  });
});

describe('toSafeErrorMessage', () => {
  it('returns the message of an Error instance', () => {
    expect(toSafeErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns a plain string as-is', () => {
    expect(toSafeErrorMessage('something failed')).toBe('something failed');
  });

  it('falls back to a generic message for other values', () => {
    expect(toSafeErrorMessage({ some: 'object' })).toBe('Unknown error');
    expect(toSafeErrorMessage(undefined)).toBe('Unknown error');
    expect(toSafeErrorMessage(42)).toBe('Unknown error');
  });
});
