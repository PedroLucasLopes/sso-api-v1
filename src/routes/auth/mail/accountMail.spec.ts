import { accountLocale, composeAccountMail } from './accountMail';

describe('e-mails de conta', () => {
  it('escreve na lingua pedida e cai no ingles quando ela nao existe', () => {
    expect(accountLocale('pt-BR')).toBe('pt-BR');
    expect(accountLocale('fr')).toBe('en');
    expect(accountLocale(undefined)).toBe('en');
  });

  it('leva o link e o prazo dele, em HTML e em texto', () => {
    const mail = composeAccountMail({
      to: 'ana@exemplo.com',
      template: 'signup',
      locale: 'pt-BR',
      application: 'Meet Me',
      link: 'http://localhost:5173/link#token=abc',
      validityMinutes: 30,
    });

    expect(mail.subject).toBe('Crie sua conta no Meet Me');
    expect(mail.html).toContain('href="http://localhost:5173/link#token=abc"');
    expect(mail.text).toContain('http://localhost:5173/link#token=abc');
    expect(mail.text).toContain('30 minutos');
  });

  it('escapa o nome da aplicacao no HTML', () => {
    const mail = composeAccountMail({
      to: 'ana@exemplo.com',
      template: 'existsWithGoogle',
      locale: 'en',
      application: '<img src=x onerror=alert(1)>',
      validityMinutes: 30,
    });

    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('aviso sem link nao mostra botao', () => {
    const mail = composeAccountMail({
      to: 'ana@exemplo.com',
      template: 'passwordChanged',
      locale: 'es',
      application: 'Meet Me',
      link: 'http://localhost:5173/link#token=abc',
      validityMinutes: 30,
    });

    expect(mail.subject).toBe('Tu contraseña de Meet Me cambió');
    expect(mail.html).not.toContain('href=');
  });

  it('o pedido de exclusao leva o link de confirmar nas tres linguas', () => {
    const subjects = (['pt-BR', 'en', 'es'] as const).map((locale) => {
      const mail = composeAccountMail({
        to: 'ana@exemplo.com',
        template: 'deletion',
        locale,
        application: 'SSO',
        link: 'http://localhost:5173/link#token=abc',
        validityMinutes: 30,
      });

      expect(mail.html).toContain(
        'href="http://localhost:5173/link#token=abc"',
      );
      expect(mail.text).toContain('http://localhost:5173/link#token=abc');

      return mail.subject;
    });

    expect(subjects).toEqual([
      'Confirme a exclusão da sua conta no SSO',
      'Confirm the deletion of your SSO account',
      'Confirma la eliminación de tu cuenta en SSO',
    ]);
  });
});
