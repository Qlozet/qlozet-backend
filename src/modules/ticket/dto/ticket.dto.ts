import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
  IsIn,
} from 'class-validator';

export class CreateTicketDto {
  @ApiProperty({ example: 'Delivery Delay', description: 'Type of issue' })
  @IsString()
  @IsNotEmpty()
  issue_type: string;

  @ApiProperty({
    example: 'My order has not arrived',
    description: 'Full description',
  })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({
    type: [String],
    required: false,
    description: 'Optional image URLs',
  })
  @IsArray()
  @IsOptional()
  images?: string[];

  // The schema field is `attachments`; `images` above is kept for clients
  // already sending it (create() maps images → attachments — before that,
  // uploaded ticket images were silently dropped on the floor).
  @ApiPropertyOptional({ type: [String], description: 'Attachment URLs' })
  @IsArray()
  @IsOptional()
  attachments?: string[];
}

export class UpdateTicketDto extends PartialType(CreateTicketDto) {
  @ApiPropertyOptional({
    description: 'Ticket status',
    enum: ['open', 'in_progress', 'resolved', 'closed'],
  })
  @IsOptional()
  @IsIn(['open', 'in_progress', 'resolved', 'closed'])
  status?: string;
}

export class AssignTicketDto {
  @ApiProperty({ description: 'Support team ID to assign ticket to' })
  @IsString()
  @IsNotEmpty()
  support_team_id: string;
}

export class TicketFilterDto {
  @ApiPropertyOptional({ description: 'Search keyword (issue or description)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Ticket status: open, in_progress, resolved, closed',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by assigned support team' })
  @IsOptional()
  @IsString()
  assigned_to?: string;

  @ApiPropertyOptional({
    description: 'Originator filter: customer | vendor',
    enum: ['customer', 'vendor'],
  })
  @IsOptional()
  @IsIn(['customer', 'vendor'])
  origin?: string;

  @ApiPropertyOptional({ description: 'Start date (ISO)' })
  @IsOptional()
  @IsString()
  start_date?: string;

  @ApiPropertyOptional({ description: 'End date (ISO)' })
  @IsOptional()
  @IsString()
  end_date?: string;
}
