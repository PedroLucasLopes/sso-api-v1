import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

/** O que a GoogleStrategy entrega ao controller depois de validar o perfil. */
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
