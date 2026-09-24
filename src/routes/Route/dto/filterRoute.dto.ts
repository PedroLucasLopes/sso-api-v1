import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Method } from 'generated/prisma/enums';
import { Pagination } from 'src/global/pagination/dto/pagination.dto';

export class FilterRoute extends Pagination {
  @IsString()
  @IsOptional()
  path?: string;

  @IsString()
  @IsOptional()
  @IsEnum(Method)
  method?: Method;
}
