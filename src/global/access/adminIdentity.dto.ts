import { Request } from 'express';

export interface AdminIdentity {
  userId: string;
  email: string;
  name: string;
  role: string;
  root: boolean;
  tokenId: string;
  via: 'bearer' | 'session';
  csrfToken?: string;
}

export interface RequestWithAdmin extends Request {
  ssoAdmin?: AdminIdentity;
}
