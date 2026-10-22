export const SMTP_TIMEOUTS_MS = {
  connection: 10_000,
  greeting: 10_000,
  socket: 20_000,
} as const;

export const SMTP_MIN_TLS_VERSION = 'TLSv1.2';

export const TRANSACTIONAL_HEADERS = {
  'Auto-Submitted': 'auto-generated',
  'X-Auto-Response-Suppress': 'All',
} as const;
