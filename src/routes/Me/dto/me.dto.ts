import { Method } from 'generated/prisma/enums';

export interface MePermission {
  path: string;
  method: Method;
}

export interface Me {
  id: string;
  email: string;
  name: string;
  role: string;
  root: boolean;
  permissions: MePermission[];
  csrfToken?: string;
}
