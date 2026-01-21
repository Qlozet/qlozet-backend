import { BadRequestException, ValidationError } from '@nestjs/common';

export function customExceptionFactory(
  validationErrors: ValidationError[] = [],
) {
  const errors = validationErrors[0];
  return errors;
}
