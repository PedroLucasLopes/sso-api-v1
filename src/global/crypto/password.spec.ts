import {
  generatePassword,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  passwordProblem,
  verifyPassword,
} from './password';

describe('senha', () => {
  it('confere a senha que gerou o hash', async () => {
    const hash = await hashPassword('senha-de-teste-123');

    expect(await verifyPassword('senha-de-teste-123', hash)).toBe(true);
  });

  it('recusa senha errada', async () => {
    const hash = await hashPassword('senha-de-teste-123');

    expect(await verifyPassword('senha-de-teste-124', hash)).toBe(false);
  });

  it('guarda o algoritmo e os parametros junto do hash', async () => {
    const [scheme, cost, blockSize, parallelism, salt, key] = (
      await hashPassword('senha-de-teste-123')
    ).split('$');

    expect(scheme).toBe('scrypt');
    expect(Number(cost)).toBeGreaterThanOrEqual(2 ** 16);
    expect(Number(blockSize)).toBe(8);
    expect(Number(parallelism)).toBe(1);
    expect(salt.length).toBeGreaterThan(20);
    expect(key.length).toBeGreaterThan(40);
  });

  it('gera hash diferente para a mesma senha', async () => {
    const [primeiro, segundo] = await Promise.all([
      hashPassword('senha-de-teste-123'),
      hashPassword('senha-de-teste-123'),
    ]);

    expect(primeiro).not.toBe(segundo);
  });

  it('trata hash corrompido como recusa, sem estourar', async () => {
    expect(await verifyPassword('qualquer', 'nao-e-um-hash')).toBe(false);
    expect(await verifyPassword('qualquer', 'scrypt$x$y$z$a$b')).toBe(false);
  });

  it('normaliza a senha antes de comparar', async () => {
    const hash = await hashPassword('ação-de-teste-1');

    expect(await verifyPassword('ação-de-teste-1'.normalize('NFD'), hash)).toBe(
      true,
    );
  });

  it('gera senha com o tamanho pedido e sem caractere ambiguo', () => {
    const password = generatePassword(20);

    expect(password).toHaveLength(20);
    expect(password).not.toMatch(/[0OIl1]/);
  });

  it('recusa senha curta, longa, com espaco na ponta e repetitiva', () => {
    expect(passwordProblem('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe(
      'too_short',
    );
    expect(passwordProblem('a'.repeat(201))).toBe('too_long');
    expect(passwordProblem(' senha-boa-de-teste ')).toBe('padded');
    expect(passwordProblem('abababababab')).toBe('too_repetitive');
    expect(passwordProblem('senha-boa-de-teste')).toBeNull();
  });
});
