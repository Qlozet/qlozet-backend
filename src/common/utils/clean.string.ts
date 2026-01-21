import { InternalServerErrorException } from '@nestjs/common';

export function toLowerCase(string: string): string {
  if (!string)
    throw new InternalServerErrorException(
      'Please pass the string you want to lowercase',
    );
  return string.toLowerCase();
}

export function trimString(string: string): string {
  if (!string)
    throw new InternalServerErrorException(
      'Please pass the string you want to trim',
    );
  return string.trim();
}
