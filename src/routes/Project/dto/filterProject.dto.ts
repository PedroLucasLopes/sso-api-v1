import { IsOptional, IsString } from 'class-validator';
import { Pagination } from 'src/global/pagination/dto/pagination.dto';

export class FilterProject extends Pagination {
  @IsString()
  @IsOptional()
  name: string;
}
