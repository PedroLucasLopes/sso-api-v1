import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class JwtPayload {
  @IsString()
  @IsNotEmpty()
  sub: string;

  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  clientId: string;

  @IsArray()
  @IsNotEmpty()
  permissions: Array<{ path: string; method: string }>;
}
