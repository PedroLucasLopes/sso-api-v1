export const PWNED_PASSWORDS = {
  rangeUrl: 'https://api.pwnedpasswords.com/range/',
  timeoutMs: 2_500,
  userAgent: 'sso-api-v1',
} as const;

export const TURNSTILE = {
  verifyUrl: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  timeoutMs: 5_000,
  warnEveryMs: 60_000,
  maxTokenLength: 2_048,
} as const;

export const TURNSTILE_TEST_KEY_PATTERN = /^[123]x0{20,}[0-9A-F]{2}$/i;

export const TURNSTILE_CONFIG_ERRORS: readonly string[] = [
  'missing-input-secret',
  'invalid-input-secret',
];

export const HUMAN_CHECK_HEADER = 'x-human-check';

export const HUMAN_CHECK_METADATA = 'sso:humanCheck';

export const HUMAN_CHECK_ACTIONS = ['signup', 'password_reset'] as const;

export type HumanCheckAction = (typeof HUMAN_CHECK_ACTIONS)[number];

export const NON_PUBLIC_RANGES = {
  ipv4: [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
  ],
  ipv6: [
    ['::', 128],
    ['::1', 128],
    ['fc00::', 7],
    ['fe80::', 10],
  ],
} as const;

export const IPV4_MAPPED_PREFIX = '::ffff:';
