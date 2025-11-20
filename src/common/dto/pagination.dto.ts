import { ApiProperty } from '@nestjs/swagger';

export class PaginatedDto<T> {
  @ApiProperty({ example: 4 })
  total_items: number;

  @ApiProperty({ example: 1 })
  total_pages: number;

  @ApiProperty({ example: 1 })
  current_page: number;

  @ApiProperty({ example: false })
  has_next_page: boolean;

  @ApiProperty({ example: false })
  has_previous_page: boolean;

  @ApiProperty({ example: 10 })
  page_size: number;

  @ApiProperty({ type: [Object] })
  data: T[];
}
