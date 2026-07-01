import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { TaxonomyService } from './taxonomy.service';
import { CreateSystemCategoryDto } from './dto/create-system-category.dto';
import { UpdateSystemCategoryDto } from './dto/update-system-category.dto';
import { BulkImportCategoriesDto } from './dto/bulk-import.dto';
import { CreateSystemTagDto } from './dto/create-system-tag.dto';
import { UpdateSystemTagDto } from './dto/update-system-tag.dto';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../ums/schemas';

@ApiTags('Taxonomy')
@Controller('taxonomy')
@UsePipes(new ValidationPipe({ transform: true }))
export class TaxonomyController {
  constructor(private readonly taxonomyService: TaxonomyService) {}

  // ─────────────────────────────────────────────────────────
  // PUBLIC ENDPOINTS — Used by Vendor App & Customer App
  // ─────────────────────────────────────────────────────────

  @Public()
  @Get('tree')
  @ApiOperation({
    summary: 'Get the full taxonomy tree grouped by kind',
    description:
      'Returns all active product types, categories, and attributes. Used by frontend for dropdowns.',
  })
  @ApiQuery({ name: 'kind', required: false, description: 'Filter by product kind' })
  getTree(@Query('kind') kind?: string) {
    return this.taxonomyService.getTree(kind);
  }

  @Public()
  @Get('product-types')
  @ApiOperation({
    summary: 'Get product types for a specific kind',
    description: 'Returns the list of allowed product_type names for dropdown population.',
  })
  @ApiQuery({ name: 'kind', required: true })
  getProductTypes(@Query('kind') kind: string) {
    return this.taxonomyService.getProductTypes(kind);
  }

  @Public()
  @Get('categories')
  @ApiOperation({
    summary: 'Get sub-categories for a specific product type',
    description: 'Returns allowed sub-categories for cascading dropdown.',
  })
  @ApiQuery({ name: 'kind', required: true })
  @ApiQuery({ name: 'product_type', required: true })
  getCategoriesForType(
    @Query('kind') kind: string,
    @Query('product_type') productType: string,
  ) {
    return this.taxonomyService.getCategoriesForType(kind, productType);
  }

  @Public()
  @Get('tags')
  @ApiOperation({
    summary: 'Get system tags',
    description: 'Returns tags filtered by assignable_by and/or kind.',
  })
  @ApiQuery({ name: 'assignable_by', required: false, description: 'Filter by who can assign (admin_only, vendor)' })
  @ApiQuery({ name: 'kind', required: false, description: 'Filter by product kind' })
  getTags(
    @Query('assignable_by') assignable_by?: string,
    @Query('kind') kind?: string,
  ) {
    return this.taxonomyService.getTags({ assignable_by, kind });
  }

  // ─────────────────────────────────────────────────────────
  // ADMIN ENDPOINTS — Category Management
  // ─────────────────────────────────────────────────────────

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserType.PLATFORM)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create a new system category (Admin only)' })
  createCategory(@Body() dto: CreateSystemCategoryDto) {
    return this.taxonomyService.createCategory(dto);
  }

  @Post('bulk')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserType.PLATFORM)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Bulk import categories (Admin only)' })
  bulkImportCategories(@Body() dto: BulkImportCategoriesDto) {
    return this.taxonomyService.bulkImportCategories(dto.items);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserType.PLATFORM)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update a system category (Admin only)' })
  updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateSystemCategoryDto,
  ) {
    return this.taxonomyService.updateCategory(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserType.PLATFORM)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Delete a system category (Admin only)' })
  deleteCategory(@Param('id') id: string) {
    return this.taxonomyService.deleteCategory(id);
  }

  // ─────────────────────────────────────────────────────────
  // ADMIN ENDPOINTS — Tag Management
  // ─────────────────────────────────────────────────────────

  @Post('tags')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserType.PLATFORM)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create a new system tag (Admin only)' })
  createTag(@Body() dto: CreateSystemTagDto) {
    return this.taxonomyService.createTag(dto);
  }

  @Patch('tags/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserType.PLATFORM)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update a system tag (Admin only)' })
  updateTag(@Param('id') id: string, @Body() dto: UpdateSystemTagDto) {
    return this.taxonomyService.updateTag(id, dto);
  }

  @Delete('tags/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserType.PLATFORM)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Delete a system tag (Admin only)' })
  deleteTag(@Param('id') id: string) {
    return this.taxonomyService.deleteTag(id);
  }

  // ─────────────────────────────────────────────────────────
  // ADMIN — Seed Default Taxonomy
  // ─────────────────────────────────────────────────────────

  @Post('seed')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserType.PLATFORM)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Seed default taxonomy data (Admin only)',
    description:
      'Populates the database with default Qlozet categories and tags. Safe to re-run — duplicates are skipped. Use ?force=true to wipe and re-seed.',
  })
  @ApiQuery({
    name: 'force',
    required: false,
    description: 'If true, deletes all existing categories and tags before re-seeding',
  })
  seed(@Query('force') force?: string) {
    return this.taxonomyService.seed(force === 'true');
  }
}
