import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CLIENT_ASSERTION_TYPE } from './token.dto';

export class ResolvePermissions {
  @IsString()
  @IsNotEmpty()
  role: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  client_id?: string;

  @IsString()
  @IsOptional()
  @IsIn([CLIENT_ASSERTION_TYPE])
  client_assertion_type?: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  client_assertion?: string;
}

export class PermissionSet {
  role: string;
  hash: string;
  permissions: Array<{ path: string; method: string }>;
}
