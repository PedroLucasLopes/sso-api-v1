import { IsEmail, IsOptional, IsString } from 'class-validator';
import { Pagination } from 'src/global/pagination/dto/pagination.dto';

export class FilterUser extends Pagination {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEmail()
  @IsOptional()
  email?: string;
}
