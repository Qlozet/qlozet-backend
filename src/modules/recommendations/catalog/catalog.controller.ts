import { Controller, Get, Post, Body, Param, UseGuards, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogBackfillService } from './catalog-backfill.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserType } from '../../ums/schemas';

@ApiTags('Catalog')
@Controller('recommendations/catalog')
export class CatalogController {
    constructor(
        private readonly catalogService: CatalogService,
        private readonly backfillService: CatalogBackfillService,
        private readonly embeddingsService: EmbeddingsService,
    ) { }

    @Post('backfill')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserType.ADMIN)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Backfill catalog from existing products (admin only)' })
    async backfill() {
        return this.backfillService.backfillAll();
    }

    @Post('backfill-embeddings')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserType.ADMIN)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Generate embeddings for catalog items without them (admin only)' })
    async backfillEmbeddings(@Query('limit') limit?: string) {
        return this.embeddingsService.backfillItemEmbeddings({
            limit: limit ? Number(limit) : undefined,
        });
    }

    @Post()
    @ApiOperation({ summary: 'Add item to catalog' })
    create(@Body() createItemDto: any) {
        return this.catalogService.create(createItemDto);
    }

    @Get()
    @ApiOperation({ summary: 'List catalog items' })
    findAll() {
        return this.catalogService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.catalogService.findById(id);
    }
}
