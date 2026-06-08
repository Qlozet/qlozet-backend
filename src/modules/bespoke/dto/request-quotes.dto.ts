import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsMongoId, ArrayMinSize, ArrayMaxSize } from 'class-validator';

export class RequestQuotesDto {
  @ApiProperty({
    description: 'Business IDs of vendors to request quotes from (max 5 total per design)',
    example: ['665abc123def456ghi789jkl', '665abc123def456ghi789jkm'],
  })
  @IsArray()
  @IsMongoId({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  vendor_ids: string[];
}
