import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConditionDto } from './collection.dto';

// ─────────────────────────────────────────────────────────
// Single Collection Response
// ─────────────────────────────────────────────────────────

export class CollectionResponseDto {
  @ApiProperty({ example: '6650a1b2c3d4e5f6a7b8c9d0' })
  _id: string;

  @ApiProperty({ example: 'New Season Suits', description: 'Collection title' })
  title: string;

  @ApiPropertyOptional({
    example: 'A curated selection of premium suits for the new season.',
    description: 'Short description',
  })
  description?: string;

  @ApiProperty({
    example: 'all',
    enum: ['all', 'any'],
    description: 'Whether all or any conditions must match',
  })
  condition_match: string;

  @ApiProperty({
    type: [ConditionDto],
    description: 'List of product-matching conditions',
    example: [
      { field: 'product_category', operator: 'is_equal_to', value: 'Suits' },
    ],
  })
  conditions: ConditionDto[];

  @ApiProperty({ example: true, description: 'Whether the collection is active' })
  is_active: boolean;

  @ApiPropertyOptional({
    example: '6650a1b2c3d4e5f6a7b8c9d1',
    description: 'Business ID (null for platform collections)',
  })
  business?: string;

  @ApiProperty({
    example: 'vendor',
    enum: ['vendor', 'platform'],
    description: 'Whether this is a vendor or platform-wide collection',
  })
  scope: string;

  @ApiPropertyOptional({
    example: 'trending-ankara-styles',
    description: 'URL-safe slug (platform collections only)',
  })
  slug?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.qlozet.com/collections/cover.jpg',
    description: 'Cover image for homepage display',
  })
  cover_image?: string;

  @ApiProperty({ example: 0, description: 'Sort order for display' })
  sort_order: number;

  @ApiProperty({ example: '2026-07-01T12:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-07-01T12:00:00.000Z' })
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────
// Paginated Response (reusable shape)
// ─────────────────────────────────────────────────────────

export class PaginationMetaDto {
  @ApiProperty({ example: 42, description: 'Total number of items' })
  total_items: number;

  @ApiProperty({ example: 5, description: 'Total number of pages' })
  total_pages: number;

  @ApiProperty({ example: 1, description: 'Current page number' })
  current_page: number;

  @ApiProperty({ example: true })
  has_next_page: boolean;

  @ApiProperty({ example: false })
  has_previous_page: boolean;

  @ApiProperty({ example: 10, description: 'Items per page' })
  page_size: number;
}

// ─────────────────────────────────────────────────────────
// Collection Products Response (paginated)
// ─────────────────────────────────────────────────────────

export class CollectionProductsResponseDto extends PaginationMetaDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: 'Array of product documents belonging to this collection',
  })
  data: any[];
}

// ─────────────────────────────────────────────────────────
// Collection With Products (for vendor/with-products)
// ─────────────────────────────────────────────────────────

export class CollectionWithProductsItemDto extends CollectionResponseDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: 'Products that matched this collection\'s conditions',
  })
  products: any[];
}

export class CollectionsWithProductsResponseDto extends PaginationMetaDto {
  @ApiProperty({
    type: [CollectionWithProductsItemDto],
    description: 'Array of collections, each with their matched products',
  })
  data: CollectionWithProductsItemDto[];
}
