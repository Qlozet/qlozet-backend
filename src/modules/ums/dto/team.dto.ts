import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, IsMongoId, IsOptional } from 'class-validator';
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
