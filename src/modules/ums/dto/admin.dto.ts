import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/** The `status` values the User schema allows. */
export const ADMIN_STATUSES = ['active', 'inactive', 'suspended'] as const;

export type AdminStatus = (typeof ADMIN_STATUSES)[number];

export class FetchAdminsDto {
  @ApiPropertyOptional({ description: 'Page number', example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', example: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  size?: number = 10;

  @ApiPropertyOptional({
    description: 'Search by name, email or phone number',
    example: 'shola',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by role — accepts the role id or its name',
    example: 'operations',
  })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ enum: ADMIN_STATUSES, example: 'active' })
  @IsOptional()
  @IsIn(ADMIN_STATUSES as unknown as string[])
  status?: AdminStatus;
}

export class CreateAdminDto {
  @ApiProperty({ example: 'Shola James' })
  @IsString()
  @IsNotEmpty()
  full_name: string;

  @ApiProperty({ example: 'shola@mail.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: '+2348123456789' })
  @IsOptional()
  @IsString()
  phone_number?: string;

  @ApiProperty({
    description:
      'The platform role to grant. Accepts the role id, or its name ("super admin", "data_analyst") so the console can send either.',
    example: '652f1b2c9f1c2a0012cd4210',
  })
  @IsString()
  @IsNotEmpty()
  role: string;
}

export class UpdateAdminDto {
  @ApiPropertyOptional({ example: 'Shola James' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  full_name?: string;

  @ApiPropertyOptional({
    description:
      'Sign-in identity. Changing it changes what the admin signs in with, so it must stay unique across every account.',
    example: 'shola@mail.com',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+2348123456789' })
  @IsOptional()
  @IsString()
  phone_number?: string;

  @ApiPropertyOptional({
    description: 'Platform role id or name',
    example: '652f1b2c9f1c2a0012cd4210',
  })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ enum: ADMIN_STATUSES, example: 'inactive' })
  @IsOptional()
  @IsIn(ADMIN_STATUSES as unknown as string[])
  status?: AdminStatus;
}

export class UpdateAdminStatusDto {
  @ApiProperty({
    enum: ADMIN_STATUSES,
    example: 'inactive',
    description:
      "Platform sign-in requires 'active', so anything else locks the admin out of the console. 'inactive' is a deactivated account; 'suspended' is one acted against.",
  })
  @IsIn(ADMIN_STATUSES as unknown as string[])
  status: AdminStatus;
}
