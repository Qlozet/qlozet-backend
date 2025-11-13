import { IsOptional, IsBoolean, IsArray, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePreferencesDto {
  @ApiPropertyOptional({
    description: 'Preferred body fit types',
    type: [String],
    example: ['slim', 'regular'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bodyFit?: string[];

  @ApiPropertyOptional({
    description: 'User preferred wears style',
    example: 'casual',
  })
  @IsOptional()
  @IsString()
  wearsPreference?: string;

  @ApiPropertyOptional({
    description: 'User aesthetic preferences',
    type: [String],
    example: ['minimalist', 'vintage'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aestheticPreferences?: string[];

  @ApiPropertyOptional({
    description: 'Email notification preferences',
    type: [String],
    example: ['promotions', 'new-arrivals'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  emailPreferences?: string[];

  @ApiPropertyOptional({
    description: 'Whether the email preferences have been selected',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isEmailPreferenceSelected?: boolean;
}
