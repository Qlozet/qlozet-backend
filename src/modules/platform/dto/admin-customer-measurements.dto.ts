import { ApiProperty } from '@nestjs/swagger';
import { BaseResponseDto } from 'src/common/dto/base-response.dto';

/**
 * Payload of GET /api/admin/customer/:id/measurements — the admin console's
 * "Body Measurement" panel on the customer detail page.
 *
 * The measurement routes under /measurements are all `@Roles(CUSTOMER)` and
 * read the caller's own id from the token, so an admin hitting them got their
 * own (empty) sets. This one takes the customer from the path, like the other
 * admin-scoped twins here.
 *
 * Read-only, deliberately: GET /measurements/body-type caches a freshly
 * computed classification back onto the user document. An admin opening a
 * panel must not write to the record they are looking at, so when there is no
 * cached classification this endpoint computes one in memory and returns it
 * unsaved.
 */
export class AdminCustomerMeasurementSetDto {
  @ApiProperty({ example: 'default' })
  name: string;

  @ApiProperty({ example: 'cm', enum: ['cm', 'inch'] })
  unit: 'cm' | 'inch';

  @ApiProperty({
    example: true,
    description:
      'The set the customer currently shops with. Exactly one is active in practice, but the schema does not enforce it.',
  })
  active: boolean;

  @ApiProperty({ example: '2026-08-25T09:12:00.000Z', nullable: true })
  created_at: Date | null;

  @ApiProperty({
    type: Object,
    example: { chest: 96, waist: 81, hip: 99 },
    description:
      'Flat { key: number } map in the set\'s `unit`. Only the keys the customer actually recorded are present — the console renders whatever it is given rather than a fixed field list.',
  })
  measurements: Record<string, number>;
}

export class AdminCustomerBodyTypeDto {
  @ApiProperty({
    example: 'inverted_triangle',
    description:
      "Classifier output: athletic | rectangle | trapezoid | round | triangle | hourglass | pear | apple | inverted_triangle | unclassified.",
  })
  type: string;

  @ApiProperty({ example: 'high', enum: ['high', 'medium', 'low'] })
  confidence: string;

  @ApiProperty({ example: ['slim', 'tailored'], type: [String] })
  flattering_fits: string[];

  @ApiProperty({ example: ['boxy'], type: [String] })
  avoid_fits: string[];

  @ApiProperty({ type: [String] })
  style_advice: string[];

  @ApiProperty({
    example: '2026-08-25T09:12:00.000Z',
    nullable: true,
    description:
      'When the classification was computed. Null when it was derived for this response rather than read from the cache.',
  })
  computed_at: Date | null;

  @ApiProperty({
    example: 'default',
    nullable: true,
    description: 'Name of the measurement set it was derived from',
  })
  from_set: string | null;
}

export class AdminCustomerMeasurementsDto {
  @ApiProperty({ example: 'John Doe' })
  full_name: string;

  @ApiProperty({
    example: 'male',
    nullable: true,
    description:
      'Drives the classifier: the male and female shape families are different, and the console labels the body-type panel with it.',
  })
  gender: string | null;

  @ApiProperty({
    type: [AdminCustomerMeasurementSetDto],
    description:
      'Every saved set, active one first. Empty when the customer has recorded none.',
  })
  sets: AdminCustomerMeasurementSetDto[];

  @ApiProperty({
    type: AdminCustomerMeasurementSetDto,
    nullable: true,
    description:
      'The active set, falling back to the first saved one. Null when there are none — which is what the console shows an empty state for.',
  })
  active_set: AdminCustomerMeasurementSetDto | null;

  @ApiProperty({
    type: AdminCustomerBodyTypeDto,
    nullable: true,
    description:
      'Cached classification when the customer has one, otherwise computed from the active set for this response only. Null when there is nothing to classify from.',
  })
  body_type: AdminCustomerBodyTypeDto | null;
}

export class AdminCustomerMeasurementsWrapperDto extends BaseResponseDto {
  @ApiProperty({ type: AdminCustomerMeasurementsDto })
  data: AdminCustomerMeasurementsDto;
}
