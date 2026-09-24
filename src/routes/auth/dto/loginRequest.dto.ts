export class LoginProvider {
  id: 'google';
  label: string;
  url: string;
}

export class LoginRequestView {
  kind: 'authorize' | 'session';
  application: string | null;
  expiresAt: string;
  providers: LoginProvider[];
}
