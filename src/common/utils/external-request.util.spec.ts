import {
  EXTERNAL_REQUEST_TIMEOUT_MS,
  externalRequestSignal,
  isExternalRequestTimeout,
} from './external-request.util';

describe('external request utilities', () => {
  it('creates a signal that aborts after the configured timeout', () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');

    const signal = externalRequestSignal();

    expect(timeoutSpy).toHaveBeenCalledWith(EXTERNAL_REQUEST_TIMEOUT_MS);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it.each(['TimeoutError', 'AbortError'])('recognizes %s', (name) => {
    const error = new Error('request aborted');
    error.name = name;

    expect(isExternalRequestTimeout(error)).toBe(true);
  });

  it('does not classify other failures as timeouts', () => {
    expect(isExternalRequestTimeout(new Error('network failure'))).toBe(false);
    expect(isExternalRequestTimeout('TimeoutError')).toBe(false);
  });
});
