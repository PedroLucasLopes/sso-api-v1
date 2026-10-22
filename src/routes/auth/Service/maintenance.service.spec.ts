import { AccountEmailService } from './accountEmail.service';
import { AuthorizationCodeService } from './authorizationCode.service';
import { AuthSessionService } from './authSession.service';
import {
  decodeCursor,
  DeletedAccountService,
  encodeCursor,
} from './deletedAccount.service';
import { MaintenanceService } from './maintenance.service';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function deleting() {
  return jest.fn().mockResolvedValue({ count: 2 });
}

function cutoffOf(deleteMany: jest.Mock, field: string): number {
  const [args] = deleteMany.mock.calls[0] as [
    { where: Record<string, { lt: Date }> },
  ];

  return args.where[field].lt.getTime();
}

describe('limpeza das linhas vencidas', () => {
  it('apaga os e-mails de conta passada a janela da cota, que e maior que a vida do link', async () => {
    const deleteMany = deleting();
    const emails = new AccountEmailService(
      { accountEmail: { deleteMany } } as never,
      { getOrThrow: () => 'http://localhost:5173/login' } as never,
    );

    const before = Date.now();

    await expect(emails.purgeStale()).resolves.toBe(2);

    const cutoff = cutoffOf(deleteMany, 'createdAt');

    expect(cutoff).toBeGreaterThanOrEqual(before - HOUR_MS);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - HOUR_MS);
  });

  it('guarda o aviso de conta excluida por 90 dias', async () => {
    const deleteMany = deleting();
    const feed = new DeletedAccountService({
      deletedAccount: { deleteMany },
    } as never);

    const before = Date.now();

    await feed.purgeExpired();

    const cutoff = cutoffOf(deleteMany, 'deletedAt');

    expect(cutoff).toBeGreaterThanOrEqual(before - 90 * DAY_MS);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - 90 * DAY_MS);
  });

  it('roda as quatro limpezas e devolve o que cada uma apagou', async () => {
    const maintenance = new MaintenanceService(
      { purgeStale: jest.fn().mockResolvedValue(3) } as never,
      { purgeExpired: jest.fn().mockResolvedValue(1) } as never,
      { purgeExpired: jest.fn().mockResolvedValue(0) } as never,
      { purgeExpired: jest.fn().mockResolvedValue(4) } as never,
    );

    await expect(maintenance.run()).resolves.toEqual({
      accountEmails: 3,
      authorizationCodes: 1,
      authSessions: 0,
      deletedAccounts: 4,
    });
  });

  it('nao roda duas vezes ao mesmo tempo, e uma falha nao derruba o processo', async () => {
    let release: (count: number) => void = () => {};
    const slow = new Promise<number>((resolve) => (release = resolve));
    const codes = {
      purgeExpired: jest.fn().mockRejectedValue(new Error('banco fora')),
    } as unknown as AuthorizationCodeService;
    const sessionPurge = jest.fn();
    const sessions = {
      purgeExpired: sessionPurge,
    } as unknown as AuthSessionService;

    const maintenance = new MaintenanceService(
      { purgeStale: jest.fn().mockReturnValue(slow) } as never,
      codes,
      sessions,
      { purgeExpired: jest.fn() } as never,
    );

    const first = maintenance.run();

    await expect(maintenance.run()).resolves.toBeNull();

    release(1);

    await expect(first).resolves.toBeNull();
    expect(sessionPurge).not.toHaveBeenCalled();
  });

  it('o cursor da lista de contas excluidas vai e volta, e recusa o que nao gerou', () => {
    const at = new Date('2026-10-22T10:00:00.000Z');
    const cursor = encodeCursor({ at, id: 'linha-1' });

    expect(decodeCursor(cursor)).toEqual({ at, id: 'linha-1' });
    expect(decodeCursor('nao-e-cursor')).toBeNull();
    expect(
      decodeCursor(Buffer.from('2026-10-22|a|b').toString('base64url')),
    ).toBeNull();
  });
});
