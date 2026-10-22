import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { DELETED_ACCOUNTS_CURSOR_MAX_LENGTH } from '../account.constant';
import { CLIENT_ASSERTION_TYPE } from './token.dto';

export class DeletedAccountsRequest {
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  client_id?: string;

  @IsString()
  @IsOptional()
  @IsIn([CLIENT_ASSERTION_TYPE])
  client_assertion_type?: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  client_assertion?: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(DELETED_ACCOUNTS_CURSOR_MAX_LENGTH)
  after?: string;
}

export class DeletedAccountsResponse {
  accounts: Array<{ sub: string; deleted_at: string }>;
  cursor: string | null;
  has_more: boolean;
}
