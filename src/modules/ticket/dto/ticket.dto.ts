import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
} from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
  IsIn,
  IsMongoId,
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

  /**
   * The vendor a customer is reporting.
   *
   * Named apart from the schema's `business` on purpose: that column means
   * "whose ticket is this" when a vendor raises one, and "who is being
   * reported" when a customer does. Letting a client write `business`
   * directly would let a customer file a ticket as a vendor, so the mapping
   * happens in the service rather than through a spread.
   */
  @ApiPropertyOptional({
    description: 'Business being reported (customer store reports only)',
  })
  @IsMongoId()
  @IsOptional()
  reported_business?: string;
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
