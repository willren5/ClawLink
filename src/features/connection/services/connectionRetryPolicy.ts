function normalizeErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }

  return String(error).toLowerCase();
}

export function isRetryableTransportError(error: unknown): boolean {
  const lowered = normalizeErrorText(error);

  if (lowered.includes('http 401') || lowered.includes('http 403')) {
    return false;
  }

  return (
    lowered.includes('network') ||
    lowered.includes('timeout') ||
    lowered.includes('ssl') ||
    lowered.includes('tls') ||
    lowered.includes('wrong version number') ||
    lowered.includes('unexpected eof') ||
    lowered.includes('econnrefused') ||
    lowered.includes('connection refused') ||
    lowered.includes('could not connect') ||
    lowered.includes('socket hang up') ||
    lowered.includes('empty reply') ||
    lowered.includes('http 404')
  );
}

export function shouldRetryWithTlsUpgrade(initialTls: boolean, error: unknown): boolean {
  return !initialTls && isRetryableTransportError(error);
}

export function buildTlsDowngradeBlockedMessage(): string {
  return 'Secure HTTPS connection failed. ClawLink will not retry over insecure HTTP automatically. Confirm the gateway protocol and retry explicitly if you intend to use HTTP.';
}
