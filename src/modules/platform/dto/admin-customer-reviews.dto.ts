import { ApiProperty } from '@nestjs/swagger';
import { BaseResponseDto } from 'src/common/dto/base-response.dto';

/**
 * Payload of GET /api/admin/customer/:id/reviews — the reviews this customer
 * WROTE, which is what the `reviews_count` on their detail header counts.
 *
 * Ratings are embedded in `products.ratings[]`, one entry per product per user,
 * so there is no reviews collection to page: the pipeline unwinds the array and
 * keeps only this customer's entries.
 *
 * snake_case keys, like every other endpoint here.
 */
export class AdminCustomerReviewDto {
  @ApiProperty({ example: '6a4a085a4ba435c95283926c' })
  product_id: string;

  @ApiProperty({
    example: 'Maison De Vetements Loafers',
    nullable: true,
    description:
      'Name off whichever variant the product is — clothing, fabric or accessory. Null when the product carries none.',
  })
  product_name: string | null;

  @ApiProperty({ example: 'clothing', enum: ['clothing', 'fabric', 'accessory'] })
  product_kind: string;

  @ApiProperty({
    example: 'https://res.cloudinary.com/...',
    nullable: true,
    description: 'First product image; null when the product has none.',
  })
  product_image: string | null;

  @ApiProperty({
    example: 'Maison De Vetements',
    nullable: true,
    description: 'The business selling it; null when the business is gone.',
  })
  vendor_name: string | null;

  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  rating: number;

  @ApiProperty({
    example: 'Great dress, it fits perfectly.',
    nullable: true,
    description: 'A rating may carry no comment — stars alone are a review.',
  })
  comment: string | null;

  @ApiProperty({
    example: '2026-08-15T09:31:00.000Z',
    nullable: true,
    description:
      "Generation time of the rating subdocument's ObjectId, which is when it was pushed. Ratings carry no timestamp of their own; null for a legacy entry saved without an _id.",
  })
  created_at: Date | null;
}

export class AdminCustomerReviewsSummaryDto {
  @ApiProperty({
    example: 12,
    description: 'Reviews this customer wrote. 0 when they have written none.',
  })
  total_reviews: number;

  @ApiProperty({
    example: 4.8,
    description:
      'Mean of the stars they gave, to one decimal. 0 when they have written none — there is no average to state.',
  })
  average_rating: number;

  @ApiProperty({ example: 35, description: 'Excellent' })
  five_star: number;

  @ApiProperty({ example: 25, description: 'Good' })
  four_star: number;

  @ApiProperty({ example: 20, description: 'Average' })
  three_star: number;

  @ApiProperty({ example: 15, description: 'Below average' })
  two_star: number;

  @ApiProperty({ example: 5, description: 'Poor' })
  one_star: number;
}

export class AdminCustomerReviewsPageDto {
  @ApiProperty({
    type: AdminCustomerReviewsSummaryDto,
    description:
      'Over ALL their reviews, not just the page — the distribution bars describe the whole history.',
  })
  summary: AdminCustomerReviewsSummaryDto;

  @ApiProperty({ type: [AdminCustomerReviewDto] })
  reviews: AdminCustomerReviewDto[];

  @ApiProperty({
    type: Object,
    example: { page: 1, size: 20, total: 12, pages: 1 },
  })
  pagination: { page: number; size: number; total: number; pages: number };
}

export class AdminCustomerReviewsWrapperDto extends BaseResponseDto {
  @ApiProperty({ type: AdminCustomerReviewsPageDto })
  data: AdminCustomerReviewsPageDto;
}
