export const EXTERNAL_REQUEST_TIMEOUT_MS = 5000;

export function externalRequestSignal(): AbortSignal {
  return AbortSignal.timeout(EXTERNAL_REQUEST_TIMEOUT_MS);
}

export function isExternalRequestTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}
