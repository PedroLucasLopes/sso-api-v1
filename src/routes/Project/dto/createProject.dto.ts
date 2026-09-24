import { IsNotEmpty, IsString } from 'class-validator';

export class CreateProject {
  @IsString()
  @IsNotEmpty()
  name: string;
}
