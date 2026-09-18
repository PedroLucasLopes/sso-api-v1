import { ValidationError } from 'class-validator';
import { ApiException } from './apiError';

/** Um campo recusado pela validacao dos DTOs. */
export interface FieldError {
  /** Caminho do campo no corpo, com ponto para aninhado: `items.0.status`. */
  field: string;
  /** Codigo estavel, que o front traduz. `invalid_value` quando a regra nao tem um. */
  error: string;
  /** Texto do class-validator, para quem le a resposta crua. Nenhum front o mostra. */
  message: string;
}

/**
 * Codigo de campo vem do `context` da regra no DTO:
 *
 *   @Matches(ROLE_NAME_PATTERN, { message: '...', context: { code: 'role_name_invalid' } })
 *
 * Regra sem codigo, como `@IsString()`, sai `invalid_value`: o front mostra a
 * recusa generica, e o texto do class-validator fica so no corpo.
 */
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

/** `exceptionFactory` do ValidationPipe: a recusa sai no contrato de erro da API. */
export function validationException(errors: ValidationError[]): ApiException {
  const fields: FieldError[] = [];

  collect(errors, '', fields);

  return new ApiException('validation_failed', { fields });
}
