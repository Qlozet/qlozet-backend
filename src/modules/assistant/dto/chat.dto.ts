import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChatDto {
  @ApiProperty({ description: "The vendor's question", example: 'How were my sales last month?' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message: string;

  @ApiPropertyOptional({
    description: 'Existing conversation to continue. Omit to start a new one.',
  })
  @IsOptional()
  @IsString()
  conversation_id?: string;
}
