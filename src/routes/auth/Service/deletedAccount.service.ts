import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/global/prisma/prisma.service';
import {
  DELETED_ACCOUNT_RETENTION_DAYS,
  DELETED_ACCOUNTS_PAGE_SIZE,
} from '../account.constant';
import { DeletedAccountsResponse } from '../dto/deletedAccounts.dto';
import { OAuthException } from '../error/oauth.exception';

interface FeedCursor {
  at: Date;
  id: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DeletedAccountService {
  constructor(private readonly prisma: PrismaService) {}

  async since(
    projectId: string,
    after?: string,
  ): Promise<DeletedAccountsResponse> {
    const cursor = after ? decodeCursor(after) : null;

    if (after && !cursor) {
      throw new OAuthException(
        'invalid_request',
        'after deve ser o cursor devolvido pela propria lista',
      );
    }

    const rows = await this.prisma.deletedAccount.findMany({
      where: {
        projectId,
        ...(cursor
          ? {
              OR: [
                { deletedAt: { gt: cursor.at } },
                { deletedAt: cursor.at, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ deletedAt: 'asc' }, { id: 'asc' }],
      take: DELETED_ACCOUNTS_PAGE_SIZE,
      select: { id: true, subject: true, deletedAt: true },
    });

    const last = rows.at(-1);

    return {
      accounts: rows.map((row) => ({
        sub: row.subject,
        deleted_at: row.deletedAt.toISOString(),
      })),
      cursor: last
        ? encodeCursor({ at: last.deletedAt, id: last.id })
        : (after ?? null),
      has_more: rows.length === DELETED_ACCOUNTS_PAGE_SIZE,
    };
  }

  async purgeExpired(): Promise<number> {
    const { count } = await this.prisma.deletedAccount.deleteMany({
      where: {
        deletedAt: {
          lt: new Date(Date.now() - DELETED_ACCOUNT_RETENTION_DAYS * DAY_MS),
        },
      },
    });

    return count;
  }
}

export function encodeCursor(cursor: FeedCursor): string {
  return Buffer.from(`${cursor.at.toISOString()}|${cursor.id}`).toString(
    'base64url',
  );
}

export function decodeCursor(raw: string): FeedCursor | null {
  const [iso, id, extra] = Buffer.from(raw, 'base64url')
    .toString('utf8')
    .split('|');
  const at = new Date(iso ?? '');

  if (!id || extra !== undefined || Number.isNaN(at.getTime())) return null;

  return { at, id };
}
