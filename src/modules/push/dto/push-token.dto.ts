import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PushApp, PushPlatform } from '../schemas/device-token.schema';

export class RegisterPushTokenDto {
  @ApiProperty({ description: 'The FCM registration token from the device' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  token: string;

  @ApiProperty({ enum: PushApp, description: 'Which app is registering: the shop or the vendor app' })
  @IsEnum(PushApp)
  app: PushApp;

  @ApiProperty({ enum: PushPlatform })
  @IsEnum(PushPlatform)
  platform: PushPlatform;

  @ApiPropertyOptional({ description: 'Stable id for this install, so a reinstall replaces the old token' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  device_id?: string;

  @ApiPropertyOptional({ description: 'App version, for delivery debugging' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  app_version?: string;
}

export class UnregisterPushTokenDto {
  @ApiProperty({ description: 'The token to stop sending to (send it before clearing the session on logout)' })
  @IsString()
  @IsNotEmpty()
  token: string;
}
