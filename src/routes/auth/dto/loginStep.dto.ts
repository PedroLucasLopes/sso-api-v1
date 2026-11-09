import { IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from 'src/global/crypto/password';
import { TOTP_DIGITS } from 'src/global/crypto/totp';

export type LoginStage = 'change_password' | 'enroll_mfa' | 'mfa';

export class LoginStepCookie {
  userId: string;
  email: string;
  stage: LoginStage;
  secret?: string;
  createdAt: number;
}

export class LoginStepView {
  next: LoginStage | 'done';
  email?: string;
  redirectTo?: string;
  secret?: string;
  otpauth?: string;
  recoveryCodes?: string[];
}

export class PasswordLogin {
  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PASSWORD_LENGTH)
  password: string;
}

export class NewPassword {
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, {
    context: { code: 'password_length' },
  })
  password: string;
}

export class MfaCode {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code: string;
}

export class RecoveryCodes {
  codes: string[];
}

export const MFA_CODE_DIGITS = TOTP_DIGITS;
