/** Estado da sessao deste navegador com o SSO, para o console decidir o que mostrar. */
export class SessionView {
  active: boolean;
  /** Quem esta com a sessao. So com `active`. */
  user?: { name: string; email: string };
  /**
   * Copia legivel do token anti-CSRF. So com `active`. Vale apenas junto do
   * cookie, e outro site nao consegue ler esta resposta.
   */
  csrfToken?: string;
}
