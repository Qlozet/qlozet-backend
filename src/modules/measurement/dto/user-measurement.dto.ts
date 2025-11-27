import { ApiProperty } from '@nestjs/swagger';
import {
  IsNumber,
  IsPositive,
  IsString,
  IsEnum,
  IsBoolean,
  IsDate,
  ValidateNested,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MeasurementDto {
  @ApiProperty({ example: 88.88 }) @IsNumber() @IsPositive() waist: number;
  @ApiProperty({ example: 96.97 }) @IsNumber() @IsPositive() hip: number;
  @ApiProperty({ example: 29.5 }) @IsNumber() @IsPositive() bicep: number;
  @ApiProperty({ example: 34.9 }) @IsNumber() @IsPositive() calf: number;
  @ApiProperty({ example: 101.04 }) @IsNumber() @IsPositive() chest: number;
  @ApiProperty({ example: 25.41 }) @IsNumber() @IsPositive() forearm: number;
  @ApiProperty({ example: 146.13 }) @IsNumber() @IsPositive() height: number;
  @ApiProperty({ example: 62.78 }) @IsNumber() @IsPositive() leg_length: number;
  @ApiProperty({ example: 34.16 })
  @IsNumber()
  @IsPositive()
  shoulder_breadth: number;
  @ApiProperty({ example: 57.06 })
  @IsNumber()
  @IsPositive()
  shoulder_to_crotch: number;
  @ApiProperty({ example: 50.95 }) @IsNumber() @IsPositive() thigh: number;
  @ApiProperty({ example: 15.69 }) @IsNumber() @IsPositive() wrist: number;
  @ApiProperty({ example: 21.81 }) @IsNumber() @IsPositive() ankle: number;
  @ApiProperty({ example: 40.65 }) @IsNumber() @IsPositive() arm_length: number;
}

export class ActiveMeasurementSetDto {
  @ApiProperty({ example: 'Jane Doe' }) @IsString() full_name: string;
  @ApiProperty({ example: 'jane@example.com' }) @IsString() email: string;
  @ApiProperty({ example: '1234567890' }) @IsString() phone_number: string;

  @ApiProperty({ example: 'default' }) @IsString() name: string;
  @ApiProperty({ example: 'cm', enum: ['cm', 'inch'] })
  @IsEnum(['cm', 'inch'])
  unit: 'cm' | 'inch';

  @ApiProperty({ type: MeasurementDto })
  @ValidateNested()
  @Type(() => MeasurementDto)
  measurements: MeasurementDto;

  @ApiProperty({ example: true }) @IsBoolean() active: boolean;
  @ApiProperty({ example: '2025-11-27T12:00:00Z' })
  @IsDate()
  @Type(() => Date)
  createdAt: Date;
}

export class MeasurementInputDto {
  @ApiProperty({ example: 88.88 }) @IsNumber() @IsPositive() waist: number;
  @ApiProperty({ example: 96.97 }) @IsNumber() @IsPositive() hip: number;
  @ApiProperty({ example: 29.5 }) @IsNumber() @IsPositive() bicep: number;
  @ApiProperty({ example: 34.9 }) @IsNumber() @IsPositive() calf: number;
  @ApiProperty({ example: 101.04 }) @IsNumber() @IsPositive() chest: number;
  @ApiProperty({ example: 25.41 }) @IsNumber() @IsPositive() forearm: number;
  @ApiProperty({ example: 146.13 }) @IsNumber() @IsPositive() height: number;
  @ApiProperty({ example: 62.78 }) @IsNumber() @IsPositive() leg_length: number;
  @ApiProperty({ example: 34.16 })
  @IsNumber()
  @IsPositive()
  shoulder_breadth: number;
  @ApiProperty({ example: 57.06 })
  @IsNumber()
  @IsPositive()
  shoulder_to_crotch: number;
  @ApiProperty({ example: 50.95 }) @IsNumber() @IsPositive() thigh: number;
  @ApiProperty({ example: 15.69 }) @IsNumber() @IsPositive() wrist: number;
  @ApiProperty({ example: 21.81 }) @IsNumber() @IsPositive() ankle: number;
  @ApiProperty({ example: 40.65 }) @IsNumber() @IsPositive() arm_length: number;
}

export class AddMeasurementSetDto {
  @ApiProperty({ example: 'default', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: 'cm', enum: ['cm', 'inch'] })
  @IsEnum(['cm', 'inch'])
  unit: 'cm' | 'inch';

  @ApiProperty({ type: MeasurementInputDto })
  @ValidateNested()
  @Type(() => MeasurementInputDto)
  measurements: MeasurementInputDto;
}
