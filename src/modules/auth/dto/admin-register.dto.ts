import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsArray,
  IsIP,
  IsEmail,
  MinLength,
  IsPhoneNumber,
} from 'class-validator';

export class AdminRegistrationDto {
  @ApiProperty({
    example: 'admin@example.com',
    description: 'Admin email address',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'Password123!', description: 'Admin password' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: 'John Admin', description: 'Full name of the admin' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiPropertyOptional({ example: '+1234567890', description: 'Phone number' })
  @IsPhoneNumber()
  @IsOptional()
  phoneNumber?: string;

  @ApiProperty({
    example: 'ADM-001',
    description: 'Employee ID',
  })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({
    example: 'Operations',
    description: 'Admin department',
    enum: [
      'Executive',
      'Marketing',
      'Operations',
      'Sales',
      'Data',
      'Support',
      'Technical',
    ],
  })
  @IsEnum([
    'Executive',
    'Marketing',
    'Operations',
    'Sales',
    'Data',
    'Support',
    'Technical',
  ])
  @IsNotEmpty()
  department: string;

  @ApiProperty({
    example: 'Operations Manager',
    description: 'Job title',
  })
  @IsString()
  @IsNotEmpty()
  jobTitle: string;

  @ApiPropertyOptional({
    example: ['impersonate_users', 'view_sensitive_data'],
    description: 'Special permissions',
    enum: [
      'impersonate_users',
      'view_sensitive_data',
      'system_maintenance',
      'bypass_approvals',
    ],
    isArray: true,
  })
  @IsArray()
  @IsEnum(
    [
      'impersonate_users',
      'view_sensitive_data',
      'system_maintenance',
      'bypass_approvals',
    ],
    { each: true },
  )
  @IsOptional()
  specialPermissions?: string[];

  @ApiPropertyOptional({
    example: 'full',
    description: 'Access level',
    enum: ['full', 'restricted', 'read_only'],
  })
  @IsEnum(['full', 'restricted', 'read_only'])
  @IsOptional()
  accessLevel?: string;

  @ApiPropertyOptional({
    example: ['192.168.1.1', '10.0.0.1'],
    description: 'Allowed IP addresses',
    isArray: true,
  })
  @IsArray()
  @IsIP(4, { each: true })
  @IsOptional()
  allowedIPs?: string[];
}
