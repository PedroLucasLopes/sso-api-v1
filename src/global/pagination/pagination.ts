import { Pagination } from './dto/pagination.dto';

type PaginationType = {
  page: number;
  limit: number;
};

export const MAX_LIMIT = 500;

export const PaginationConfig = (
  paginationDto?: Pagination,
): PaginationType => {
  const paginationRegister = numberFormatter(paginationDto?.page);
  const paginationInterval = Math.min(
    numberFormatter(1, 10, paginationDto?.limit),
    MAX_LIMIT,
  );

  const limit = Number(paginationInterval) || 10;
  const page =
    ((Number(paginationRegister) || 1) - 1) *
    (Number(paginationInterval) || 10);

  return { page, limit };
};

const numberFormatter = (
  limit: number = 1,
  min: number = 1,
  max?: number,
): number => {
  return Math.max(Number(max) || limit, min);
};
