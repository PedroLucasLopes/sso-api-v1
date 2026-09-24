import { IsEnum, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { Method } from 'generated/prisma/enums';

export class CreateRoute {
  @IsString()
  @IsNotEmpty()
  path: string;

  @IsString()
  @IsEnum(Method)
  @IsNotEmpty()
  method: Method;

  @IsString()
  @IsUUID(4, { each: true })
  @IsNotEmpty()
  projectId: string;
}
