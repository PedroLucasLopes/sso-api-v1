export const ACCOUNT_LOCALES = ['pt-BR', 'en', 'es'] as const;

export type AccountLocale = (typeof ACCOUNT_LOCALES)[number];

export const DEFAULT_ACCOUNT_LOCALE: AccountLocale = 'en';

export type AccountMailTemplate =
  | 'signup'
  | 'existsWithReset'
  | 'existsWithGoogle'
  | 'reset'
  | 'passwordChanged'
  | 'deletion';

export interface AccountMailText {
  subject: string;
  heading: string;
  body: string;
  action?: string;
  closing: string;
}

export interface AccountMailCatalog {
  templates: Record<AccountMailTemplate, AccountMailText>;
  validity: string;
  fallback: string;
  footer: string;
}

export const ACCOUNT_MAIL_MESSAGES: Record<AccountLocale, AccountMailCatalog> =
  {
    'pt-BR': {
      templates: {
        signup: {
          subject: 'Crie sua conta no {app}',
          heading: 'Falta pouco para criar sua conta',
          body: 'Recebemos um pedido para criar uma conta no {app} com este e-mail. Abra o link para escolher seu nome e sua senha.',
          action: 'Criar minha conta',
          closing:
            'Se não foi você, ignore este e-mail: nenhuma conta é criada sem o link.',
        },
        existsWithReset: {
          subject: 'Você já tem uma conta no {app}',
          heading: 'Este e-mail já tem uma conta',
          body: 'Alguém pediu para criar uma conta no {app} com este e-mail, mas ele já tem uma. Entre com a sua senha. Se você não lembra dela, crie uma senha nova pelo link.',
          action: 'Criar uma senha nova',
          closing:
            'Se não foi você, ignore este e-mail: sua senha continua a mesma.',
        },
        existsWithGoogle: {
          subject: 'Você já tem uma conta no {app}',
          heading: 'Este e-mail já tem uma conta',
          body: 'Alguém pediu uma conta ou uma senha nova no {app} com este e-mail. A sua conta entra pelo Google: na tela de entrada, use "Continuar com Google".',
          closing:
            'Se não foi você, ignore este e-mail: nada mudou na sua conta.',
        },
        reset: {
          subject: 'Senha nova para o {app}',
          heading: 'Crie uma senha nova',
          body: 'Recebemos um pedido de senha nova para a sua conta no {app}. Abra o link para escolher a nova senha.',
          action: 'Criar uma senha nova',
          closing:
            'Se não foi você, ignore este e-mail: sua senha continua a mesma.',
        },
        passwordChanged: {
          subject: 'Sua senha do {app} foi trocada',
          heading: 'Sua senha foi trocada',
          body: 'A senha da sua conta acabou de ser trocada pelo link enviado a este e-mail, e todas as sessões abertas foram encerradas.',
          closing:
            'Se não foi você, peça uma senha nova agora, pela tela de entrada do {app}.',
        },
        deletion: {
          subject: 'Confirme a exclusão da sua conta no {app}',
          heading: 'Excluir a sua conta',
          body: 'Recebemos um pedido, feito pela página da sua conta, para excluir a sua conta no {app}. Ao confirmar pelo link, a conta, a senha, o segundo fator e o acesso a todas as aplicações que entram pelo {app} são apagados, e essas aplicações são avisadas para apagar o que guardam de você. Não há como desfazer.',
          action: 'Confirmar a exclusão',
          closing:
            'Se não foi você, ignore este e-mail e troque a sua senha: a conta só é excluída pelo link.',
        },
      },
      validity: 'O link vale por {minutes} minutos e funciona uma vez.',
      fallback: 'Se o botão não abrir, copie este endereço no navegador:',
      footer:
        'E-mail automático, enviado pela entrada do {app}. Não é preciso responder.',
    },
    en: {
      templates: {
        signup: {
          subject: 'Create your {app} account',
          heading: 'Almost there',
          body: 'We received a request to create a {app} account with this e-mail. Open the link to choose your name and password.',
          action: 'Create my account',
          closing:
            "If this wasn't you, ignore this e-mail: no account is created without the link.",
        },
        existsWithReset: {
          subject: 'You already have a {app} account',
          heading: 'This e-mail already has an account',
          body: "Someone asked to create a {app} account with this e-mail, but it already has one. Sign in with your password. If you don't remember it, create a new one with the link.",
          action: 'Create a new password',
          closing:
            "If this wasn't you, ignore this e-mail: your password stays the same.",
        },
        existsWithGoogle: {
          subject: 'You already have a {app} account',
          heading: 'This e-mail already has an account',
          body: 'Someone asked for an account or a new password on {app} with this e-mail. Your account signs in with Google: on the sign-in screen, use "Continue with Google".',
          closing:
            "If this wasn't you, ignore this e-mail: nothing changed in your account.",
        },
        reset: {
          subject: 'New password for {app}',
          heading: 'Create a new password',
          body: 'We received a request for a new password for your {app} account. Open the link to choose it.',
          action: 'Create a new password',
          closing:
            "If this wasn't you, ignore this e-mail: your password stays the same.",
        },
        passwordChanged: {
          subject: 'Your {app} password was changed',
          heading: 'Your password was changed',
          body: 'Your account password was just changed through the link sent to this e-mail, and every open session was signed out.',
          closing:
            "If this wasn't you, ask for a new password now on the {app} sign-in screen.",
        },
        deletion: {
          subject: 'Confirm the deletion of your {app} account',
          heading: 'Delete your account',
          body: 'We received a request, made from your account page, to delete your {app} account. Once you confirm with the link, the account, its password, its second factor and its access to every application that signs in through {app} are erased, and those applications are told to erase what they keep about you. This cannot be undone.',
          action: 'Confirm the deletion',
          closing:
            "If this wasn't you, ignore this e-mail and change your password: the account is only deleted through the link.",
        },
      },
      validity: 'The link is valid for {minutes} minutes and works once.',
      fallback:
        "If the button doesn't open, copy this address into your browser:",
      footer: 'Automatic e-mail sent by the {app} sign-in. No need to reply.',
    },
    es: {
      templates: {
        signup: {
          subject: 'Crea tu cuenta en {app}',
          heading: 'Ya casi está',
          body: 'Recibimos una solicitud para crear una cuenta en {app} con este correo. Abre el enlace para elegir tu nombre y tu contraseña.',
          action: 'Crear mi cuenta',
          closing:
            'Si no fuiste tú, ignora este correo: no se crea ninguna cuenta sin el enlace.',
        },
        existsWithReset: {
          subject: 'Ya tienes una cuenta en {app}',
          heading: 'Este correo ya tiene una cuenta',
          body: 'Alguien pidió crear una cuenta en {app} con este correo, pero ya tiene una. Entra con tu contraseña. Si no la recuerdas, crea una nueva con el enlace.',
          action: 'Crear una contraseña nueva',
          closing:
            'Si no fuiste tú, ignora este correo: tu contraseña sigue siendo la misma.',
        },
        existsWithGoogle: {
          subject: 'Ya tienes una cuenta en {app}',
          heading: 'Este correo ya tiene una cuenta',
          body: 'Alguien pidió una cuenta o una contraseña nueva en {app} con este correo. Tu cuenta entra con Google: en la pantalla de acceso, usa "Continuar con Google".',
          closing:
            'Si no fuiste tú, ignora este correo: nada cambió en tu cuenta.',
        },
        reset: {
          subject: 'Contraseña nueva para {app}',
          heading: 'Crea una contraseña nueva',
          body: 'Recibimos una solicitud de contraseña nueva para tu cuenta en {app}. Abre el enlace para elegirla.',
          action: 'Crear una contraseña nueva',
          closing:
            'Si no fuiste tú, ignora este correo: tu contraseña sigue siendo la misma.',
        },
        passwordChanged: {
          subject: 'Tu contraseña de {app} cambió',
          heading: 'Tu contraseña cambió',
          body: 'La contraseña de tu cuenta se acaba de cambiar con el enlace enviado a este correo, y se cerraron todas las sesiones abiertas.',
          closing:
            'Si no fuiste tú, pide una contraseña nueva ahora en la pantalla de acceso de {app}.',
        },
        deletion: {
          subject: 'Confirma la eliminación de tu cuenta en {app}',
          heading: 'Eliminar tu cuenta',
          body: 'Recibimos una solicitud, hecha desde la página de tu cuenta, para eliminar tu cuenta en {app}. Al confirmar con el enlace, se borran la cuenta, su contraseña, su segundo factor y el acceso a todas las aplicaciones que entran por {app}, y esas aplicaciones reciben el aviso para borrar lo que guardan sobre ti. No se puede deshacer.',
          action: 'Confirmar la eliminación',
          closing:
            'Si no fuiste tú, ignora este correo y cambia tu contraseña: la cuenta solo se elimina con el enlace.',
        },
      },
      validity: 'El enlace vale por {minutes} minutos y funciona una vez.',
      fallback: 'Si el botón no abre, copia esta dirección en el navegador:',
      footer:
        'Correo automático enviado por el acceso de {app}. No hace falta responder.',
    },
  };

export const ACCOUNT_MAIL_STYLE = {
  page: '#f4f5f7',
  card: '#ffffff',
  text: '#1f2329',
  muted: '#5f6670',
  faint: '#8a9099',
  rule: '#e6e8eb',
  action: '#1f5eff',
  onAction: '#ffffff',
  font: 'Arial, Helvetica, sans-serif',
} as const;
