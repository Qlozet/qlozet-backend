import { ApiBody, ApiConsumes, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsNumber, IsString } from 'class-validator';
import { BODY_SHAPE_VALUES } from '../body-shape';
import type {
  BodyBuild,
  Legs,
  Shoulders,
  Stomach,
  Thighs,
} from '../body-shape';

export class RunPredictBodyDto {
  @ApiProperty({ description: 'User height in cm', required: false })
  @IsOptional()
  @IsNumber()
  height_cm?: number;

  @ApiProperty({ description: 'User weight in kg', required: false })
  @IsOptional()
  @IsNumber()
  weight?: number;

  @ApiProperty({
    description: 'Gender',
    enum: ['male', 'female'],
    example: 'female',
  })
  gender: 'male' | 'female';

  @ApiProperty({ description: 'Additional notes', required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  // Body shape, in the person's own words. Optional; the model runs on
  // height/weight/gender and these nudge its output - see body-shape.ts.
  @ApiProperty({ required: false, enum: BODY_SHAPE_VALUES.build })
  @IsOptional()
  @IsIn([...BODY_SHAPE_VALUES.build])
  build?: BodyBuild;

  @ApiProperty({ required: false, enum: BODY_SHAPE_VALUES.stomach })
  @IsOptional()
  @IsIn([...BODY_SHAPE_VALUES.stomach])
  stomach?: Stomach;

  @ApiProperty({ required: false, enum: BODY_SHAPE_VALUES.shoulders })
  @IsOptional()
  @IsIn([...BODY_SHAPE_VALUES.shoulders])
  shoulders?: Shoulders;

  @ApiProperty({ required: false, enum: BODY_SHAPE_VALUES.legs })
  @IsOptional()
  @IsIn([...BODY_SHAPE_VALUES.legs])
  legs?: Legs;

  @ApiProperty({ required: false, enum: BODY_SHAPE_VALUES.thighs })
  @IsOptional()
  @IsIn([...BODY_SHAPE_VALUES.thighs])
  thighs?: Thighs;

  business?: string;
  customer?: string;
}

export class RunPredictSwaggerDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'Front image' })
  front_image: any;

  @ApiProperty({ type: 'string', format: 'binary', description: 'Side image' })
  side_image: any;

  @ApiProperty({ type: RunPredictBodyDto })
  body: RunPredictBodyDto;
}
