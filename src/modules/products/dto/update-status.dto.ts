// dto/update-status.dto.ts
import { IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export class UpdateStatusDto {
  @ApiProperty({
    description: 'New status of the product',
    enum: ['active', 'draft', 'archived'],
  })
  @IsEnum(['active', 'draft', 'archived'])
  status: 'active' | 'draft' | 'archived';
}

export class ScheduleActivationDto {
  @ApiProperty({
    description:
      'Date and time to activate the product automatically (must be in the future)',
    example: '2025-12-10T10:00:00Z',
  })
  @IsDateString()
  activation_date: string;
}
