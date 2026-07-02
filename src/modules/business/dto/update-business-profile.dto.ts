import { IsOptional, IsString, IsArray } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateBusinessProfileDto {
  @ApiPropertyOptional({ example: 'Qlozet Fashion House' })
  @IsOptional()
  @IsString()
  business_name?: string;

  @ApiPropertyOptional({ example: 'contact@qlozet.com' })
  @IsOptional()
  @IsString()
  business_email?: string;

  @ApiPropertyOptional({ example: '+2348012345678' })
  @IsOptional()
  @IsString()
  business_phone_number?: string;

  @ApiPropertyOptional({ example: 'https://www.qlozet.com' })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional({ example: 'Premium African fashion brand specializing in bespoke designs.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: '2020' })
  @IsOptional()
  @IsString()
  year_founded?: string;

  @ApiPropertyOptional({ example: 'https://cdn.qlozet.com/logos/business-logo.png' })
  @IsOptional()
  @IsString()
  business_logo_url?: string;

  @ApiPropertyOptional({ example: 'https://cdn.qlozet.com/logos/business-logo.svg' })
  @IsOptional()
  @IsString()
  business_logo_svg_url?: string;

  @ApiPropertyOptional({ example: 'https://cdn.qlozet.com/covers/storefront.jpg' })
  @IsOptional()
  @IsString()
  cover_image_url?: string;

  @ApiPropertyOptional({
    example: ['https://cdn.qlozet.com/docs/cac-cert.pdf'],
    description: 'Array of CAC document URLs',
  })
  @IsOptional()
  @IsArray()
  cac_document_url?: string[];

  @ApiPropertyOptional({ example: '12345678901' })
  @IsOptional()
  @IsString()
  nin?: string;

  @ApiPropertyOptional({ example: '22345678901' })
  @IsOptional()
  @IsString()
  bvn?: string;
}
