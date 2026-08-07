import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsMongoId,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { Types } from 'mongoose';

export class InviteTeamMemberDto {
  @ApiProperty({ description: 'Role ID to assign to the member' })
  @IsMongoId()
  role: string;

  @ApiProperty({ description: 'Email of the member to invite' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Full name of the member' })
  @IsString()
  @IsNotEmpty()
  full_name: string;

  @ApiPropertyOptional({ description: 'Phone number of the member (optional)' })
  @IsOptional()
  @IsString()
  phone_number?: string;
}

export class UpdateTeamMemberDto {
  @ApiPropertyOptional({ description: 'Full name of the member' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  full_name?: string;

  @ApiPropertyOptional({ description: 'Phone number of the member' })
  @IsOptional()
  @IsString()
  phone_number?: string;

  @ApiPropertyOptional({ description: 'Role ID to assign to the member' })
  @IsOptional()
  @IsMongoId()
  role?: string;

  @ApiPropertyOptional({
    description: 'Active status — set false to soft-disable the member',
  })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
