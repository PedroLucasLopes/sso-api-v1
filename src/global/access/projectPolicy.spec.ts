import { MfaPolicy, SignupPolicy } from 'generated/prisma/enums';
import {
  acceptsSignup,
  enteringRole,
  ProjectAccessPolicy,
  secondFactorOptional,
} from './projectPolicy';

const TRAVELER = 'papel-viajante';
const CURATOR = 'papel-curador';

function project(
  overrides: Partial<ProjectAccessPolicy> = {},
): ProjectAccessPolicy {
  return {
    id: 'projeto-meetme',
    name: 'MEETME',
    signupPolicy: SignupPolicy.OPEN,
    mfaPolicy: MfaPolicy.OPTIONAL,
    defaultRoleId: TRAVELER,
    ...overrides,
  };
}

describe('politica de cadastro e de segundo fator do projeto', () => {
  it('projeto OPEN com papel padrao aceita cadastro', () => {
    expect(acceptsSignup(project())).toBe(true);
  });

  it('o padrao CLOSED nao aceita cadastro', () => {
    expect(acceptsSignup(project({ signupPolicy: SignupPolicy.CLOSED }))).toBe(
      false,
    );
  });

  it('OPEN sem papel padrao nao aceita cadastro', () => {
    expect(acceptsSignup(project({ defaultRoleId: null }))).toBe(false);
  });

  it('o projeto SSO nunca aceita cadastro, mesmo marcado OPEN no banco', () => {
    expect(acceptsSignup(project({ name: 'SSO' }))).toBe(false);
  });

  it('quem ja e membro entra com o proprio papel', () => {
    expect(enteringRole(project(), CURATOR)).toBe(CURATOR);
  });

  it('quem nao e membro entra com o papel padrao so em projeto OPEN', () => {
    expect(enteringRole(project(), null)).toBe(TRAVELER);
    expect(
      enteringRole(project({ signupPolicy: SignupPolicy.CLOSED }), null),
    ).toBeNull();
  });

  it('quem foi tirado do projeto nao volta sozinho com o papel padrao', () => {
    expect(enteringRole(project(), null, true)).toBeNull();
  });

  it('o bloqueio nao pesa sobre quem foi vinculado de novo', () => {
    expect(enteringRole(project(), CURATOR, true)).toBe(CURATOR);
  });

  it('o segundo fator so e opcional para o papel padrao de um projeto OPTIONAL', () => {
    expect(secondFactorOptional(project(), TRAVELER)).toBe(true);
    expect(secondFactorOptional(project(), CURATOR)).toBe(false);
    expect(secondFactorOptional(project(), null)).toBe(false);
  });

  it('REQUIRED, o padrao, exige o segundo fator de todo mundo', () => {
    expect(
      secondFactorOptional(
        project({ mfaPolicy: MfaPolicy.REQUIRED }),
        TRAVELER,
      ),
    ).toBe(false);
  });

  it('OPTIONAL sem papel padrao nao dispensa ninguem', () => {
    expect(secondFactorOptional(project({ defaultRoleId: null }), null)).toBe(
      false,
    );
  });

  it('o projeto SSO nunca dispensa o segundo fator', () => {
    expect(secondFactorOptional(project({ name: 'SSO' }), TRAVELER)).toBe(
      false,
    );
  });
});
