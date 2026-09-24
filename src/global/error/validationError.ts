import { ValidationError } from 'class-validator';
import { ApiException } from './apiError';

export interface FieldError {
  field: string;
  error: string;
  message: string;
}

function collect(
  errors: ValidationError[],
  prefix: string,
  fields: FieldError[],
): void {
  for (const error of errors) {
    const field = prefix ? `${prefix}.${error.property}` : error.property;

    for (const [rule, message] of Object.entries(error.constraints ?? {})) {
      const context = error.contexts?.[rule] as { code?: unknown } | undefined;
      const code = context?.code;

      fields.push({
        field,
        error: typeof code === 'string' ? code : 'invalid_value',
        message,
      });
    }

    if (error.children?.length) collect(error.children, field, fields);
  }
}

export function validationException(errors: ValidationError[]): ApiException {
  const fields: FieldError[] = [];

  collect(errors, '', fields);

  return new ApiException('validation_failed', { fields });
}
