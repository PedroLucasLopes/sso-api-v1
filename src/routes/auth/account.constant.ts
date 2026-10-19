export const ACCOUNT_LINK_PATH = '/link';

export const ACCOUNT_LINK_TTL_MINUTES = 30;

export const ACCOUNT_LINK_TOKEN_BYTES = 32;

export const ACCOUNT_TOKEN_MAX_LENGTH = 128;

export const ACCOUNT_EMAILS_PER_HOUR = 3;

export const ACCOUNT_NAME_LENGTH = { min: 2, max: 100 } as const;

export const ACCOUNT_EMAIL_MAX_LENGTH = 254;

export const ACCOUNT_REQUEST_LIMIT = { default: { limit: 10, ttl: 60_000 } };

export const ACCOUNT_LINK_LIMIT = { default: { limit: 10, ttl: 60_000 } };
