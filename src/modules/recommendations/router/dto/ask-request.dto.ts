import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsNumber,
  IsArray,
  IsEnum,
  ValidateNested,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ChatMessageDto {
  @ApiProperty({
    description: 'Role of the message sender',
    enum: ['user', 'assistant'],
    example: 'user',
  })
  @IsEnum(['user', 'assistant'])
  role: 'user' | 'assistant';

  @ApiProperty({
    description: 'Message content',
    example: 'Show me agbada styles',
  })
  @IsString()
  @MaxLength(1000)
  content: string;
}

export class AskRequestDto {
  @ApiProperty({
    description: 'Natural language fashion query',
    example: 'Show me red dresses for a wedding under 50k',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty({ message: 'Query is required' })
  @MaxLength(500, { message: 'Query too long (max 500 characters)' })
  query: string;

  @ApiProperty({ required: false, description: 'User ID for personalization' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiProperty({ required: false, description: 'Session ID for context' })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiProperty({
    required: false,
    description: 'Max products to return (default 10, max 20)',
    default: 10,
    maximum: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(20, { message: 'Limit must be ≤ 20' })
  limit?: number;

  @ApiProperty({
    required: false,
    description: 'Previous conversation messages for multi-turn context (max 10 turns)',
    type: [ChatMessageDto],
    example: [
      { role: 'user', content: 'Show me agbada styles' },
      { role: 'assistant', content: 'Here are some agbada options...' },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];
}
