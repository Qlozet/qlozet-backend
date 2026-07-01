import { PartialType } from '@nestjs/swagger';
import { CreateSystemCategoryDto } from './create-system-category.dto';

export class UpdateSystemCategoryDto extends PartialType(
  CreateSystemCategoryDto,
) {}
