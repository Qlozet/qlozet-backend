import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { BroadcastAudience } from '../schemas/broadcast.schema';

export class CreateBroadcastDto {
  @ApiProperty({ example: 'Qlozet is closed for Eid on Monday' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(150)
  subject: string;

  @ApiProperty({
    description:
      'The message, as HTML from the composer. Rendered inside the shared ' +
      'email shell, and flattened to plain text for the in-app bell.',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(20000)
  body: string;

  @ApiProperty({ enum: BroadcastAudience })
  @IsEnum(BroadcastAudience)
  audience: BroadcastAudience;

  @ApiPropertyOptional({
    default: true,
    description:
      'In-app is always sent. Email is opt-in per announcement, because ' +
      'emailing every customer is a different order of commitment.',
  })
  @IsOptional()
  @IsBoolean()
  send_email?: boolean;

  @ApiPropertyOptional({
    description:
      'ISO timestamp to send at. Omitted, or in the past, means send now.',
  })
  @IsOptional()
  @IsISO8601()
  scheduled_at?: string;
}
