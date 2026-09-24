import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export const STATE_PATTERN = /^[A-Za-z0-9\-._~]{16,256}$/;

export class SessionLogin {
  @IsString()
  @IsNotEmpty()
  redirect_uri: string;

  @IsString()
  @IsOptional()
  state?: string;
}
