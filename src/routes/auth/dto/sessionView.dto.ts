export class SessionView {
  active: boolean;
  user?: { name: string; email: string };
  csrfToken?: string;
}
