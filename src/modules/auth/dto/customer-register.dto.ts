import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDate, IsString, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { BaseRegistrationDto } from './base-register.dto';

export class CustomerRegistrationDto extends BaseRegistrationDto {
  @ApiPropertyOptional({ description: 'Date of birth of customer' })
  @IsOptional()
  dob?: string;
}
