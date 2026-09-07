import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

  // ── Tailoring measurements (optional) ──
  // Derived by the prediction service (silhouette rows + ANSUR II fits) and
  // editable by the customer. Stored in the same open measurements map; the
  // order snapshot copies them wholesale so vendors sew from real numbers.
  @ApiPropertyOptional({ example: 70.9 }) @IsOptional() @IsNumber() @IsPositive() inseam?: number;
  @ApiPropertyOptional({ example: 112.3 }) @IsOptional() @IsNumber() @IsPositive() outseam?: number;
  @ApiPropertyOptional({ example: 82.1 }) @IsOptional() @IsNumber() @IsPositive() sleeve_length?: number;
  @ApiPropertyOptional({ example: 39.7 }) @IsOptional() @IsNumber() @IsPositive() nape_to_waist?: number;
  @ApiPropertyOptional({ example: 47.4 }) @IsOptional() @IsNumber() @IsPositive() neck?: number;
  @ApiPropertyOptional({ example: 52.4 }) @IsOptional() @IsNumber() @IsPositive() neck_base?: number;
  @ApiPropertyOptional({ example: 44.4 }) @IsOptional() @IsNumber() @IsPositive() knee?: number;
  @ApiPropertyOptional({ example: 59.0 }) @IsOptional() @IsNumber() @IsPositive() mid_thigh?: number;
  @ApiPropertyOptional({ example: 52.1 }) @IsOptional() @IsNumber() @IsPositive() lower_thigh?: number;
  @ApiPropertyOptional({ example: 127.9 }) @IsOptional() @IsNumber() @IsPositive() belly_waist?: number;
  @ApiPropertyOptional({ example: 129.3 }) @IsOptional() @IsNumber() @IsPositive() top_hip?: number;
  @ApiPropertyOptional({ example: 119.8 }) @IsOptional() @IsNumber() @IsPositive() under_bust?: number;
  @ApiPropertyOptional({ example: 120.6 }) @IsOptional() @IsNumber() @IsPositive() waist_height?: number;
  @ApiPropertyOptional({ example: 7.5 }) @IsOptional() @IsNumber() @IsPositive() ankle_height?: number;
  @ApiPropertyOptional({ example: 160.3 }) @IsOptional() @IsNumber() @IsPositive() neck_height?: number;
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

export class UpdateMeasurementSetDto {
  @ApiProperty({ example: 'cm', enum: ['cm', 'inch'], required: false })
  @IsOptional()
  @IsEnum(['cm', 'inch'])
  unit?: 'cm' | 'inch';

  @ApiProperty({ type: MeasurementInputDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => MeasurementInputDto)
  measurements?: MeasurementInputDto;
}
