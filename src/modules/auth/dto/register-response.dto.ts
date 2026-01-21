import { Expose, Type } from 'class-transformer';
import { Tokens } from 'src/common/types';

export class BaseUserResponseDto {
  @Expose()
  id: string;

  @Expose()
  email: string;

  @Expose()
  status: string;

  @Expose()
  createdAt: Date;
}

export class CustomerResponseDto extends BaseUserResponseDto {
  @Expose()
  fullName: string;

  @Expose()
  firstName: string;

  @Expose()
  lastName: string;

  @Expose()
  phoneNumber: string;

  @Expose()
  profilePicture?: string;

  @Expose()
  emailVerified: boolean;
}

export class VendorResponseDto extends BaseUserResponseDto {
  @Expose()
  businessName: string;

  @Expose()
  businessEmail: string;

  @Expose()
  businessPhoneNumber: string;

  @Expose()
  personalName: string;

  @Expose()
  personalPhoneNumber: string;

  @Expose()
  verificationStatus: string;

  @Expose()
  isVerified: boolean;

  @Expose()
  isActive: boolean;
}

export class RegisterResponseDto {
  @Expose()
  userId: string;

  @Expose()
  email: string;

  @Expose()
  userType: 'customer' | 'vendor';

  @Expose()
  requiresVerification: boolean;

  @Expose()
  token?: Tokens;

  @Expose()
  tokenType: string;

  @Expose()
  expiresIn: number;

  @Expose()
  @Type(() => BaseUserResponseDto)
  profile: CustomerResponseDto | VendorResponseDto;

  constructor(partial: Partial<RegisterResponseDto>) {
    Object.assign(this, partial);
    this.tokenType = this.tokenType || 'Bearer';
    this.expiresIn = this.expiresIn || 86400; // 24 hours in seconds
  }
}
