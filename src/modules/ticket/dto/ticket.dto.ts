import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsArray } from 'class-validator';

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
}

export class UpdateTicketDto extends PartialType(CreateTicketDto) {}

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

  @ApiPropertyOptional({ description: 'Start date (ISO)' })
  @IsOptional()
  @IsString()
  start_date?: string;

  @ApiPropertyOptional({ description: 'End date (ISO)' })
  @IsOptional()
  @IsString()
  end_date?: string;
}
