export const DEFAULT_ROLE_NAMES = [
  'SUPERADMIN',
  'ADMIN',
  'MANAGER',
  'VIEWER',
] as const;

export const ROLE_NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/;
