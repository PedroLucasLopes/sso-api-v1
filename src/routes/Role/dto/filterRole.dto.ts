import { IsOptional, IsString } from 'class-validator';
import { Pagination } from 'src/global/pagination/dto/pagination.dto';

export class FilterRole extends Pagination {
  @IsOptional()
  @IsString()
  name?: string;
}
