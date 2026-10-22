import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from 'src/global/crypto/password';
import {
  ACCOUNT_EMAIL_MAX_LENGTH,
  ACCOUNT_NAME_LENGTH,
  ACCOUNT_TOKEN_MAX_LENGTH,
} from '../account.constant';
import { ACCOUNT_LOCALES } from '../mail/accountMail.messages';

export class AccountEmailRequest {
  @IsEmail({}, { context: { code: 'email_invalid' } })
  @MaxLength(ACCOUNT_EMAIL_MAX_LENGTH, { context: { code: 'email_invalid' } })
  email: string;

  @IsOptional()
  @IsIn(ACCOUNT_LOCALES)
  locale?: string;
}

export class AccountLinkToken {
  @IsString()
  @IsNotEmpty()
  @MaxLength(ACCOUNT_TOKEN_MAX_LENGTH)
  token: string;
}

export class AccountPassword extends AccountLinkToken {
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, {
    context: { code: 'password_length' },
  })
  password: string;
}

export class AccountSignup extends AccountPassword {
  @IsString()
  @Length(ACCOUNT_NAME_LENGTH.min, ACCOUNT_NAME_LENGTH.max, {
    context: { code: 'name_length' },
  })
  @Matches(/\p{L}/u, { context: { code: 'name_invalid' } })
  name: string;
}

export class AccountLinkView {
  purpose: 'signup' | 'password' | 'delete';
  email: string;
  application: string;
  logo: string | null;
}

export class AccountMfaSetup {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_PASSWORD_LENGTH)
  password?: string;
}

export class AccountDeletionRequest {
  @IsOptional()
  @IsIn(ACCOUNT_LOCALES)
  locale?: string;
}

export class AccountProfileView {
  name: string;
  email: string;
  password: boolean;
  google: boolean;
  applications: string[];
  secondFactor: { enrolled: boolean; recoveryCodesLeft: number };
  deletion: {
    allowed: boolean;
    reason: 'admin' | 'email_unavailable' | null;
  };
  csrfToken: string;
}

export class AccountMfaSetupView {
  secret: string;
  otpauth: string;
}

export class AccountMfaConfirmView {
  recoveryCodes: string[];
}

export class AccountDeletionView {
  next: 'check_email' | 'deleted';
  email?: string;
}

export class AccountMfaPending {
  userId: string;
  sessionId: string;
  secret: string;
  createdAt: number;
}
