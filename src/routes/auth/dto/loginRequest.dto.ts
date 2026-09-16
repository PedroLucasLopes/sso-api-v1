/** Provedor de identidade oferecido na tela de login. */
export class LoginProvider {
  id: 'google';
  label: string;
  /** Endereco absoluto que inicia a federacao. Navegacao de pagina, nunca fetch. */
  url: string;
}

/**
 * O que a tela de login precisa para se desenhar.
 *
 * So existe enquanto houver pedido pendente. Sem ele a tela nao oferece login
 * nenhum: o IdP e um passo de um fluxo que uma aplicacao inicia, nao uma
 * pagina que se visita.
 */
export class LoginRequestView {
  /** `authorize` para aplicacao cliente, `session` para o console do SSO. */
  kind: 'authorize' | 'session';
  /** Nome da aplicacao que pediu o login. */
  application: string | null;
  /** ISO 8601. Depois disso a pessoa precisa recomecar pela aplicacao. */
  expiresAt: string;
  providers: LoginProvider[];
}
