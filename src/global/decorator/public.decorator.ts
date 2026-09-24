import { SetMetadata } from '@nestjs/common';
import {
  SSO_LEVEL_AUTHENTICATED,
  SSO_LEVEL_PUBLIC,
} from '../constants/ssoLevel.constant';

export const Public = () => SetMetadata(SSO_LEVEL_PUBLIC, true);

export const Authenticated = () => SetMetadata(SSO_LEVEL_AUTHENTICATED, true);
