import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export const PKCE_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

export class Authorize {
  @IsString()
  @IsNotEmpty()
  client_id: string;

  @IsString()
  @IsNotEmpty()
  redirect_uri: string;

  @IsString()
  @IsOptional()
  response_type?: string;

  @IsString()
  @IsOptional()
  code_challenge?: string;

  @IsString()
  @IsOptional()
  code_challenge_method?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  scope?: string;
}
