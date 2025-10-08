import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDate, IsString, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { BaseRegistrationDto } from './base-register.dto';

export class CustomerRegistrationDto extends BaseRegistrationDto {
  @ApiPropertyOptional({ example: 'johndoe123', description: 'Username' })
  @IsString()
  @IsOptional()
  userName?: string;

  @ApiPropertyOptional({ example: '1990-01-01', description: 'Date of birth' })
  @IsDate()
  @Type(() => Date)
  @IsOptional()
  dob?: Date;
}
