import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateUser {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail({}, { context: { code: 'email_invalid' } })
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsOptional()
  authId: string;
}
