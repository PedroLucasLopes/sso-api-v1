import { IsNotEmpty, IsString } from 'class-validator';

export class CreateRedirectUri {
  @IsString()
  @IsNotEmpty()
  redirectUri: string;

  @IsString()
  @IsNotEmpty()
  projectId: string;
}
