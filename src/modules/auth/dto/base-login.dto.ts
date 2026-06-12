import {
  IsEmail,
  IsString,
  MinLength,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { Transform } from 'class-transformer';
// Re-export the canonical UserType from user schema for backward compatibility
export { UserType } from '../../ums/schemas/user.schema';

export class BaseLoginDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @Transform(({ value }) => value.toLowerCase().trim())
  email: string;

  @IsString({ message: 'Password must be a string' })
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password: string;

  @IsOptional()
  @IsString({ message: 'Device identifier must be a string' })
  deviceId?: string;

  @IsOptional()
  @IsString({ message: 'Device type must be a string' })
  deviceType?: string; // 'web', 'ios', 'android'
}
