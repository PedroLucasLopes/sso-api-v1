import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreatePermission {
  @IsString()
  @IsUUID(4, { each: true })
  @IsNotEmpty()
  roleId: string;

  @IsString()
  @IsUUID(4, { each: true })
  @IsNotEmpty()
  routeId: string;
}
