import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CLIENT_ASSERTION_TYPE } from './token.dto';

export class Introspect {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @IsOptional()
  @IsIn(['access_token', 'refresh_token'])
  token_type_hint?: string;

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

export interface IntrospectionResponse {
  active: boolean;
  client_id?: string;
  token_type?: 'Bearer';
  sub?: string;
  aud?: string;
  iss?: string;
  jti?: string;
  exp?: number;
  iat?: number;
  sid?: string;
  roles?: string[];
  perm?: string;
}
