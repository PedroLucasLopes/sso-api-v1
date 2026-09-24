import { IsNotEmpty, IsUUID } from 'class-validator';

export class CreateProjectUser {
  @IsUUID(4, { each: true })
  @IsNotEmpty()
  userId: string;

  @IsUUID(4, { each: true })
  @IsNotEmpty()
  projectId: string;

  @IsUUID(4, { each: true })
  @IsNotEmpty()
  roleId: string;
}
