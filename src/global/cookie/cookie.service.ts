import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { openCompact, readKey, sealCompact } from '../crypto/aead';

@Injectable()
export class CookieService {
  private readonly key: Buffer;
  private readonly secure: boolean;
  private readonly sameSite: 'lax' | 'strict' | 'none';

  constructor(config: ConfigService) {
    this.key = readKey(
      config.getOrThrow<string>('COOKIE_SECRET'),
      'COOKIE_SECRET',
    );
    this.secure = config.get<string>('COOKIE_SECURE', 'true') !== 'false';

    const sameSite = config.get<string>('COOKIE_SAMESITE', 'lax').toLowerCase();

    this.sameSite =
      sameSite === 'strict' || sameSite === 'none' ? sameSite : 'lax';
  }

  name(base: string): string {
    return this.secure ? `__Host-${base}` : base;
  }

  set(
    res: Response,
    base: string,
    payload: unknown,
    maxAgeSeconds: number,
    overrides: Partial<CookieOptions> = {},
  ): void {
    res.cookie(
      this.name(base),
      sealCompact(this.key, JSON.stringify(payload)),
      {
        httpOnly: true,
        secure: this.secure,
        sameSite: this.sameSite,
        path: '/',
        maxAge: maxAgeSeconds * 1000,
        ...overrides,
      },
    );
  }

  get<T>(req: Request, base: string): T | null {
    const raw = (req.cookies as Record<string, string> | undefined)?.[
      this.name(base)
    ];

    if (!raw) return null;

    const plaintext = openCompact(this.key, raw);

    if (!plaintext) return null;

    try {
      return JSON.parse(plaintext) as T;
    } catch {
      return null;
    }
  }

  clear(
    res: Response,
    base: string,
    overrides: Partial<CookieOptions> = {},
  ): void {
    res.clearCookie(this.name(base), {
      httpOnly: true,
      secure: this.secure,
      sameSite: this.sameSite,
      path: '/',
      ...overrides,
    });
  }
}
