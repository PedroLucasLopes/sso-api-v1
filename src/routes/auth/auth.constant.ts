export const SSO_TX_COOKIE = 'sso_tx';

export const SSO_SESSION_COOKIE = 'sso_session';

export const TX_COOKIE_TTL_SECONDS = 300;

export const SSO_CSRF_HEADER = 'x-csrf-token';

export type LoginErrorCode =
  | 'no_pending_request'
  | 'request_expired'
  | 'account_not_registered'
  | 'email_not_verified'
  | 'account_mismatch'
  | 'provider_denied'
  | 'provider_error';
