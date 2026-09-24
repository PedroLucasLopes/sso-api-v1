import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { PKCE_PATTERN } from './authorize.dto';

export const CLIENT_ASSERTION_TYPE =
  'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

export class Token {
  @IsString()
  @IsIn(['authorization_code', 'refresh_token'], {
    context: { code: 'unsupported_grant_type' },
  })
  grant_type: 'authorization_code' | 'refresh_token';

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  code?: string;

  @IsString()
  @IsOptional()
  @Matches(PKCE_PATTERN, {
    message:
      'code_verifier deve ter de 43 a 128 caracteres do conjunto unreserved',
  })
  code_verifier?: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  redirect_uri?: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  refresh_token?: string;

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
