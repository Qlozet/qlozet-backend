import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

export class CreateTicketReplyDto {
  @ApiProperty({ example: 'Please provide an update' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiPropertyOptional({ type: [String], example: ['https://img.com/1.jpg'] })
  @IsArray()
  @IsOptional()
  attachments?: string[];
}

export class TicketReplyResponseDto {
  @ApiProperty()
  _id: string;

  @ApiProperty()
  ticket_id: string;

  @ApiProperty()
  sender: string;

  @ApiProperty({ example: 'vendor' })
  sender_type: string;

  @ApiProperty()
  message: string;

  @ApiProperty({ type: [String] })
  attachments: string[];

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}
