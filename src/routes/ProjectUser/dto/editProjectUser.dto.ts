import { IsNotEmpty, IsUUID } from 'class-validator';

export class EditProjectUser {
  @IsUUID(4)
  @IsNotEmpty()
  roleId: string;
}
