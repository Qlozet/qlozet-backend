import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class RevisionRequestDto {
  @ApiProperty({
    example: 'Can you reduce the fabric cost? Also, I need a faster turnaround.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message: string;
}
