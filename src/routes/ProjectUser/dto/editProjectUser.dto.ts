import { IsNotEmpty, IsUUID } from 'class-validator';

/** Troca o papel de quem ja e membro. Um papel por pessoa por projeto. */
export class EditProjectUser {
  @IsUUID(4)
  @IsNotEmpty()
  roleId: string;
}
