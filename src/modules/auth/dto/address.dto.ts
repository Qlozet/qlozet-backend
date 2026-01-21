import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsPostalCode } from 'class-validator';

export class AddressDto {
  @ApiPropertyOptional({
    example: '123 Main St',
    description: 'Street address',
  })
  @IsString()
  @IsOptional()
  street?: string;

  @ApiPropertyOptional({ example: 'New York', description: 'City' })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ example: 'NY', description: 'State' })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiPropertyOptional({ example: 'US', description: 'Country' })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({ example: '10001', description: 'ZIP/Postal code' })
  @IsPostalCode('any')
  @IsOptional()
  zipCode?: string;
}
