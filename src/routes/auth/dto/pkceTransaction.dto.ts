export class PkceTransaction {
  kind?: 'authorize';
  projectId: string;
  clientId: string;
  projectName?: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  googleNonce: string;
  createdAt: number;
}

export class SessionTransaction {
  kind: 'session';
  projectId: string;
  projectName: string;
  redirectUri: string;
  state: string;
  googleNonce: string;
  createdAt: number;
}

export type LoginTransaction = PkceTransaction | SessionTransaction;

export class SsoSessionCookie {
  authSessionId: string;
  csrf?: string;
}
