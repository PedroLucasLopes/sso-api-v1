import { chosenPasswordProblem, isPredictablePassword } from './passwordPolicy';

const owner = {
  email: 'ana.souza@exemplo.com',
  name: 'Ana Júlia Souza',
  serviceNames: ['MEETME', 'Meet Me'],
};

describe('senha escolhida pela pessoa', () => {
  it('aceita senha longa com letras e numeros, sem dado pessoal', () => {
    expect(chosenPasswordProblem('Viagem-ao-Japao-2027', owner)).toBeNull();
  });

  it('mantem as regras de comprimento e de espaco do SSO', () => {
    expect(chosenPasswordProblem('Curta12', owner)).toBe('too_short');
    expect(chosenPasswordProblem(' Viagem-2027-longa ', owner)).toBe('padded');
  });

  it('exige letras e numeros', () => {
    expect(chosenPasswordProblem('so-letras-aqui-sem-digito', owner)).toBe(
      'needs_letters_and_digits',
    );
    expect(chosenPasswordProblem('2027-0412-9988-31', owner)).toBe(
      'needs_letters_and_digits',
    );
  });

  it('recusa o nome, sem ligar para acento e maiuscula', () => {
    expect(chosenPasswordProblem('JULIA-viaja-2027', owner)).toBe(
      'personal_data',
    );
    expect(chosenPasswordProblem('souza-em-lisboa-9', owner)).toBe(
      'personal_data',
    );
  });

  it('recusa o e-mail e o comeco dele', () => {
    expect(chosenPasswordProblem('ana.souza-2027-ok', owner)).toBe(
      'personal_data',
    );
  });

  it('recusa o nome da aplicacao', () => {
    expect(chosenPasswordProblem('meetme-ferias-2027', owner)).toBe(
      'personal_data',
    );
  });

  it('palavra curta do nome nao conta como dado pessoal', () => {
    expect(chosenPasswordProblem('Ana-viaja-ao-Peru-2027', owner)).toBeNull();
  });

  it('recusa sequencia ou repeticao que domina a senha', () => {
    expect(isPredictablePassword('abcdefgh1234')).toBe(true);
    expect(isPredictablePassword('aaaaaaaa1111')).toBe(true);
    expect(chosenPasswordProblem('abababab12', owner)).toBe('too_short');
    expect(chosenPasswordProblem('abcdefghijk12', owner)).toBe('predictable');
  });

  it('um trecho previsivel numa senha longa passa', () => {
    expect(isPredictablePassword('Passeio-por-Kyoto-1234')).toBe(false);
  });
});
