import { IsOptional, IsArray, IsString, IsDate, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: '+2348012345678' })
  @IsOptional()
  @IsString()
  phone_number?: string;

  @ApiPropertyOptional({ example: '1999-05-12' })
  @IsOptional()
  @IsDate()
  dob?: Date;

  @ApiPropertyOptional({ example: 'female', enum: ['male', 'female'] })
  @IsOptional()
  @IsEnum(['male', 'female'])
  gender?: 'male' | 'female';

  @ApiPropertyOptional({
    example:
      'https://res.cloudinary.com/demo/image/upload/v123456789/profile.jpg',
  })
  @IsOptional()
  @IsString()
  profile_picture?: string;

  @ApiPropertyOptional({ example: 'modest wear' })
  @IsOptional()
  @IsString()
  wears_preference?: string;

  @ApiPropertyOptional({ example: ['elegant', 'minimalist'] })
  @IsOptional()
  @IsArray()
  aesthetic_preferences?: string[];

  @ApiPropertyOptional({ example: ['slim', 'tall'] })
  @IsOptional()
  @IsArray()
  body_fit?: string[];
}
