export class UserCredentialView {
  password: {
    issued: boolean;
    mustChange: boolean;
    lockedUntil: string | null;
    updatedAt: string | null;
  };

  mfa: {
    enrolled: boolean;
    confirmedAt: string | null;
    recoveryCodesLeft: number;
  };
}

export class IssuedPassword {
  email: string;
  password: string;
}
