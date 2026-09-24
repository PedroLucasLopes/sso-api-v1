import { Injectable, Logger } from '@nestjs/common';
import { KeyEncryptionService } from 'src/global/crypto/keyEncryption.service';
import {
  generatePassword,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from 'src/global/crypto/password';
import {
  generateRecoveryCode,
  generateSecret,
  normalizeRecoveryCode,
  otpauthUrl,
  verifyCode,
} from 'src/global/crypto/totp';
import { ApiException } from 'src/global/error/apiError';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { hashPassword as hashRecovery } from 'src/global/crypto/password';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
export const RECOVERY_CODE_COUNT = 8;

const DUMMY_HASH =
  'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export type PasswordCheck =
  | { ok: true; userId: string; email: string; mustChange: boolean }
  | { ok: false; reason: 'invalid' | 'locked' };

export interface MfaStatus {
  enrolled: boolean;
  confirmedAt: Date | null;
  recoveryCodesLeft: number;
}

@Injectable()
export class CredentialService {
  private readonly logger = new Logger(CredentialService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: KeyEncryptionService,
  ) {}

  async issuePassword(userId: string): Promise<string> {
    const password = generatePassword();
    const hash = await hashPassword(password);

    await this.prisma.userPassword.upsert({
      where: { userId },
      create: { userId, hash, mustChange: true },
      update: {
        hash,
        mustChange: true,
        failedCount: 0,
        lockedUntil: null,
      },
    });

    return password;
  }

  async revokePassword(userId: string): Promise<void> {
    await this.prisma.userPassword.deleteMany({ where: { userId } });
  }

  async replacePassword(userId: string, password: string): Promise<void> {
    const problem = passwordProblem(password);

    if (problem) {
      throw new ApiException('password_refused', { reason: problem });
    }

    await this.prisma.userPassword.update({
      where: { userId },
      data: {
        hash: await hashPassword(password),
        mustChange: false,
        failedCount: 0,
        lockedUntil: null,
      },
    });
  }

  async checkPassword(email: string, password: string): Promise<PasswordCheck> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { password: true },
    });

    if (!user?.password) {
      await verifyPassword(password, DUMMY_HASH);

      return { ok: false, reason: 'invalid' };
    }

    const credential = user.password;

    if (credential.lockedUntil && credential.lockedUntil > new Date()) {
      return { ok: false, reason: 'locked' };
    }

    if (!(await verifyPassword(password, credential.hash))) {
      const failedCount = credential.failedCount + 1;
      const locked = failedCount >= MAX_FAILED_ATTEMPTS;

      await this.prisma.userPassword.update({
        where: { userId: user.id },
        data: {
          failedCount: locked ? 0 : failedCount,
          lockedUntil: locked
            ? new Date(Date.now() + LOCK_MINUTES * 60_000)
            : null,
        },
      });

      if (locked) {
        this.logger.warn(`conta bloqueada por tentativas: ${user.id}`);

        return { ok: false, reason: 'locked' };
      }

      return { ok: false, reason: 'invalid' };
    }

    if (credential.failedCount > 0 || credential.lockedUntil) {
      await this.prisma.userPassword.update({
        where: { userId: user.id },
        data: { failedCount: 0, lockedUntil: null },
      });
    }

    return {
      ok: true,
      userId: user.id,
      email: user.email,
      mustChange: credential.mustChange,
    };
  }

  async mfaStatus(userId: string): Promise<MfaStatus> {
    const mfa = await this.prisma.userMfa.findUnique({ where: { userId } });

    return {
      enrolled: !!mfa?.confirmedAt,
      confirmedAt: mfa?.confirmedAt ?? null,
      recoveryCodesLeft: mfa?.recoveryCodes.length ?? 0,
    };
  }

  startMfaEnrollment(
    email: string,
    issuer: string,
  ): {
    secret: string;
    otpauth: string;
  } {
    const secret = generateSecret();

    return { secret, otpauth: otpauthUrl({ secret, email, issuer }) };
  }

  async confirmMfaEnrollment(
    userId: string,
    secret: string,
    code: string,
  ): Promise<string[]> {
    const attempt = verifyCode(secret, code);

    if (!attempt.ok) throw new ApiException('mfa_code_invalid');

    const recoveryCodes = Array.from(
      { length: RECOVERY_CODE_COUNT },
      generateRecoveryCode,
    );
    const hashed = await Promise.all(
      recoveryCodes.map((code) => hashRecovery(normalizeRecoveryCode(code))),
    );

    await this.prisma.userMfa.upsert({
      where: { userId },
      create: {
        userId,
        secret: this.keys.sealToken(secret),
        confirmedAt: new Date(),
        lastStep: attempt.step,
        recoveryCodes: hashed,
      },
      update: {
        secret: this.keys.sealToken(secret),
        confirmedAt: new Date(),
        lastStep: attempt.step,
        recoveryCodes: hashed,
      },
    });

    return recoveryCodes;
  }

  async verifyMfa(userId: string, code: string): Promise<boolean> {
    const mfa = await this.prisma.userMfa.findUnique({ where: { userId } });

    if (!mfa?.confirmedAt) return false;

    const attempt = verifyCode(this.keys.openToken(mfa.secret), code, {
      lastStep: mfa.lastStep,
    });

    if (attempt.ok) {
      await this.prisma.userMfa.update({
        where: { userId },
        data: { lastStep: attempt.step },
      });

      return true;
    }

    return this.consumeRecoveryCode(userId, code, mfa.recoveryCodes);
  }

  async resetMfa(userId: string): Promise<void> {
    await this.prisma.userMfa.deleteMany({ where: { userId } });
  }

  async credentialView(userId: string): Promise<{
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
  }> {
    const [password, mfa] = await Promise.all([
      this.prisma.userPassword.findUnique({ where: { userId } }),
      this.mfaStatus(userId),
    ]);

    return {
      password: {
        issued: !!password,
        mustChange: password?.mustChange ?? false,
        lockedUntil: password?.lockedUntil?.toISOString() ?? null,
        updatedAt: password?.updatedAt.toISOString() ?? null,
      },
      mfa: {
        enrolled: mfa.enrolled,
        confirmedAt: mfa.confirmedAt?.toISOString() ?? null,
        recoveryCodesLeft: mfa.recoveryCodesLeft,
      },
    };
  }

  private async consumeRecoveryCode(
    userId: string,
    code: string,
    stored: string[],
  ): Promise<boolean> {
    const candidate = normalizeRecoveryCode(code);

    if (candidate.length === 0) return false;

    for (const hash of stored) {
      if (!(await verifyPassword(candidate, hash))) continue;

      await this.prisma.userMfa.update({
        where: { userId },
        data: { recoveryCodes: stored.filter((entry) => entry !== hash) },
      });

      this.logger.warn(`codigo de recuperacao usado: ${userId}`);

      return true;
    }

    return false;
  }
}
