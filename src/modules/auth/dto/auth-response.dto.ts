import { ApiProperty } from '@nestjs/swagger';

class UserResponseDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011', description: 'User ID' })
  id: string;

  @ApiProperty({ example: 'user@example.com', description: 'User email' })
  email: string;

  @ApiProperty({ example: 'John Doe', description: 'Full name' })
  fullName: string;

  @ApiProperty({ example: 'active', description: 'User status' })
  status: string;

  @ApiProperty({ example: 'user', description: 'User role' })
  role: string;

  @ApiProperty({
    example: 'https://example.com/avatar.jpg',
    description: 'Profile picture URL',
  })
  profilePicture: string;

  @ApiProperty({
    example: '2023-01-01T00:00:00.000Z',
    description: 'Creation date',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2023-01-01T00:00:00.000Z',
    description: 'Last update date',
  })
  updatedAt: Date;

  // Optional fields for different user types
  @ApiProperty({
    example: 'johndoe123',
    description: 'Username',
    required: false,
  })
  userName?: string;

  @ApiProperty({
    example: 'Fashion Store Inc',
    description: 'Business name',
    required: false,
  })
  businessName?: string;

  @ApiProperty({
    example: 'ADM-001',
    description: 'Employee ID',
    required: false,
  })
  employeeId?: string;

  @ApiProperty({
    example: 'Operations',
    description: 'Department',
    required: false,
  })
  department?: string;

  @ApiProperty({
    example: 'Operations Manager',
    description: 'Job title',
    required: false,
  })
  jobTitle?: string;

  @ApiProperty({
    example: 'full',
    description: 'Access level',
    required: false,
  })
  accessLevel?: string;
}

export class TokenDto {
  @ApiProperty({
    description: 'Access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({
    description: 'Refresh token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  refreshToken: string;

  @ApiProperty({
    example: '2023-01-01T00:00:00.000Z',
    description: 'Token expiration',
  })
  expiresIn: Date;
}

export class AuthDataDto {
  @ApiProperty({
    type: UserResponseDto,
    description: 'User information',
  })
  user: UserResponseDto;

  @ApiProperty({
    type: TokenDto,
    description: 'Token information',
  })
  token: TokenDto;
}

export class AuthResponseDto {
  @ApiProperty({
    type: AuthDataDto,
    description: 'Response data',
  })
  data: AuthDataDto;

  @ApiProperty({
    example: 'Customer registered successfully',
    description: 'Response message',
  })
  message: string;
}
