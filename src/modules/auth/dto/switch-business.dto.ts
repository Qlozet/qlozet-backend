import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class SwitchBusinessDto {
  @ApiProperty({ description: 'The business ID to switch to' })
  @IsMongoId()
  business_id: string;
}
