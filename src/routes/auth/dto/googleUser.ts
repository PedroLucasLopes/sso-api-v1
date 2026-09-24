import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class GoogleUser {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  name: string;
}
