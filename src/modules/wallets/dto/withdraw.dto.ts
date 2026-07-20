import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, Min } from 'class-validator';

export class WithdrawDto {
  @ApiProperty({
    description: 'Amount to withdraw in Naira',
    example: 5000,
    minimum: 1,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  amount: number;
}
