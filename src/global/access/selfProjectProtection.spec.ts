import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { AdminIdentity } from './adminIdentity.dto';
import {
  assertKeepsRoot,
  assertNotRootRole,
  assertSelfWriter,
  LAST_SUPERADMIN,
  SELF_PROJECT_PROTECTED,
} from './selfProjectProtection';

const SSO_ID = 'projeto-sso';
const APP_ID = 'projeto-app';

/**
 * Banco de mentira com o minimo que as regras consultam: o nome de cada
 * projeto e quantos SUPERADMIN do SSO existem alem da pessoa em questao.
 *
 * Existe porque o teste ponta a ponta nao alcanca a regra do ultimo
 * SUPERADMIN: o operador dele ja e um segundo SUPERADMIN, e chegar ao ultimo
 * exigiria rebaixar a raiz real do ambiente.
 */
function fakePrisma(otherRoots = 0) {
  const count = jest.fn().mockResolvedValue(otherRoots);
  const names: Record<string, string> = { [SSO_ID]: 'SSO', [APP_ID]: 'KRLOC' };

  const prisma = {
    project: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(names[where.id] ? { name: names[where.id] } : null),
      ),
    },
    projectUser: { count },
  };

  return { prisma: prisma as unknown as PrismaService, count };
}

function admin(root: boolean): AdminIdentity {
  return {
    userId: 'pessoa',
    email: 'gestor@exemplo.com',
    name: 'Gestor',
    role: root ? 'SUPERADMIN' : 'ARQUITETO',
    root,
    tokenId: 'jti',
    via: 'bearer',
  };
}

/** O codigo da recusa, ou `undefined` quando a regra deixa passar. */
async function refusal(check: Promise<void>): Promise<string | undefined> {
  try {
    await check;
    return undefined;
  } catch (error) {
    if (!(error instanceof ForbiddenException)) throw error;

    return (error.getResponse() as { error?: string }).error;
  }
}

describe('assertKeepsRoot', () => {
  const lastRoot = {
    userId: 'pessoa',
    projectId: SSO_ID,
    roleName: 'SUPERADMIN',
  };

  it('recusa tirar do SSO o ultimo SUPERADMIN', async () => {
    const { prisma } = fakePrisma(0);

    expect(await refusal(assertKeepsRoot(prisma, lastRoot))).toBe(
      LAST_SUPERADMIN,
    );
  });

  it('recusa trocar o papel do ultimo SUPERADMIN do SSO', async () => {
    const { prisma } = fakePrisma(0);

    expect(await refusal(assertKeepsRoot(prisma, lastRoot, 'ADMIN'))).toBe(
      LAST_SUPERADMIN,
    );
  });

  it('conta so os outros SUPERADMIN do projeto SSO', async () => {
    const { prisma, count } = fakePrisma(0);

    await refusal(assertKeepsRoot(prisma, lastRoot));

    expect(count).toHaveBeenCalledWith({
      where: {
        projectId: SSO_ID,
        role: { name: 'SUPERADMIN' },
        userId: { not: 'pessoa' },
      },
    });
  });

  it('deixa sair quando sobra outro SUPERADMIN', async () => {
    const { prisma } = fakePrisma(1);

    expect(await refusal(assertKeepsRoot(prisma, lastRoot))).toBeUndefined();
  });

  it('continuar SUPERADMIN nao conta como perder a raiz', async () => {
    const { prisma, count } = fakePrisma(0);

    expect(
      await refusal(assertKeepsRoot(prisma, lastRoot, 'SUPERADMIN')),
    ).toBeUndefined();
    expect(count).not.toHaveBeenCalled();
  });

  it('nao se aplica a quem nao e SUPERADMIN', async () => {
    const { prisma, count } = fakePrisma(0);

    expect(
      await refusal(
        assertKeepsRoot(prisma, { ...lastRoot, roleName: 'ADMIN' }),
      ),
    ).toBeUndefined();
    expect(count).not.toHaveBeenCalled();
  });

  it('nao se aplica ao SUPERADMIN de outra aplicacao', async () => {
    const { prisma, count } = fakePrisma(0);

    expect(
      await refusal(
        assertKeepsRoot(prisma, { ...lastRoot, projectId: APP_ID }),
      ),
    ).toBeUndefined();
    expect(count).not.toHaveBeenCalled();
  });
});

describe('assertSelfWriter', () => {
  it('deixa a raiz escrever no SSO', async () => {
    const { prisma } = fakePrisma();

    expect(
      await refusal(assertSelfWriter(prisma, admin(true), SSO_ID)),
    ).toBeUndefined();
  });

  it('recusa no SSO quem nao e a raiz, mesmo com a permissao da rota', async () => {
    const { prisma } = fakePrisma();

    expect(await refusal(assertSelfWriter(prisma, admin(false), SSO_ID))).toBe(
      SELF_PROJECT_PROTECTED,
    );
  });

  it('recusa mover um item de outra aplicacao para dentro do SSO', async () => {
    const { prisma } = fakePrisma();

    expect(
      await refusal(assertSelfWriter(prisma, admin(false), APP_ID, SSO_ID)),
    ).toBe(SELF_PROJECT_PROTECTED);
  });

  it('deixa quem nao e a raiz escrever nas outras aplicacoes', async () => {
    const { prisma } = fakePrisma();

    expect(
      await refusal(assertSelfWriter(prisma, admin(false), APP_ID, undefined)),
    ).toBeUndefined();
  });
});

describe('assertNotRootRole', () => {
  it('o SUPERADMIN do SSO nao se renomeia nem se apaga, nem pela raiz', async () => {
    const { prisma } = fakePrisma();

    expect(
      await refusal(
        assertNotRootRole(prisma, { name: 'SUPERADMIN', projectId: SSO_ID }),
      ),
    ).toBe(SELF_PROJECT_PROTECTED);
  });

  it('o SUPERADMIN de outra aplicacao e um papel como os outros', async () => {
    const { prisma } = fakePrisma();

    expect(
      await refusal(
        assertNotRootRole(prisma, { name: 'SUPERADMIN', projectId: APP_ID }),
      ),
    ).toBeUndefined();
  });

  it('os outros papeis do SSO nao sao a raiz', async () => {
    const { prisma } = fakePrisma();

    expect(
      await refusal(
        assertNotRootRole(prisma, { name: 'ADMIN', projectId: SSO_ID }),
      ),
    ).toBeUndefined();
  });
});
