import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { CreateSystemCategoryDto } from './create-system-category.dto';

export class BulkImportCategoriesDto {
  @ApiProperty({
    type: [CreateSystemCategoryDto],
    description: 'Array of categories to bulk import',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSystemCategoryDto)
  items: CreateSystemCategoryDto[];
}
