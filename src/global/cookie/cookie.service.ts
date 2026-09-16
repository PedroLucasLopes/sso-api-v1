import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { openCompact, readKey, sealCompact } from '../crypto/aead';

/**
 * Cookies cifrados, usados no lugar do Redis para o estado que vive no
 * navegador durante o fluxo OAuth.
 *
 * RFC 10017 secao 6.1.3.2: Secure e HttpOnly sao MUST; SameSite, path `/`,
 * ausencia de Domain e prefixo `__Host-` sao SHOULD. O conteudo e cifrado
 * porque carrega dado de transacao, nao so um identificador opaco.
 *
 * Sobre o SameSite da transacao: o retorno do Google para o callback do SSO
 * e uma navegacao cross-site, e `Strict` nao acompanha esse salto. Por isso
 * o cookie de transacao e sempre `lax`, independente da configuracao. So a
 * sessao pode ser `strict`, e apenas quando tudo vive na mesma origem.
 */
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

  /**
   * O prefixo `__Host-` so e valido em cookie Secure, com Path=/ e sem Domain.
   * Em desenvolvimento sobre HTTP o navegador recusaria o cookie, entao o
   * prefixo cai junto com o Secure.
   */
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

  /** Devolve null quando o cookie nao existe, expirou ou nao abre. */
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

  /**
   * Path e nome precisam bater com os do `set`, senao o navegador guarda um
   * segundo cookie em vez de apagar o primeiro. `overrides` existe para o
   * cookie de transacao, gravado sempre como `lax`: apagar com outro
   * SameSite funcionaria, porque a identidade do cookie e (nome, dominio,
   * caminho), mas deixaria os dois lados contraditorios.
   */
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
