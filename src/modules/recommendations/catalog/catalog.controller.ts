import { Controller, Get, Post, Body, Param, UseGuards, Query } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { CatalogService } from './catalog.service';
import { CatalogBackfillService } from './catalog-backfill.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { VectorSearchService } from '../retrieval/vector-search.service';
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
        private readonly vectorSearchService: VectorSearchService,
    ) { }

    // ─── Admin: Backfill ─────────────────────────────────

    @Public()
    @Post('backfill')
    @ApiOperation({ summary: 'Backfill catalog from existing products (TEMPORARILY PUBLIC)' })
    async backfill() {
        return this.backfillService.backfillAll();
    }

    @Public()
    @Post('backfill-embeddings')
    @ApiOperation({ summary: 'Generate embeddings for catalog items (TEMPORARILY PUBLIC)' })
    async backfillEmbeddings(@Query('limit') limit?: string) {
        return this.embeddingsService.backfillItemEmbeddings({
            limit: limit ? Number(limit) : undefined,
        });
    }

    // ─── Admin: Diagnostics ──────────────────────────────

    @Get('diagnostics/vector-search')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserType.ADMIN)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Test if Atlas vector search index exists and works (admin only)' })
    async checkVectorSearch() {
        const result = await this.vectorSearchService.testIndex('items_style_vindex');
        return {
            status: result.exists ? 'OK' : 'FAILED',
            indexName: 'items_style_vindex',
            ...result,
            hint: result.exists
                ? null
                : 'Create the items_style_vindex in Atlas Console → Database → Search Indexes. See walkthrough for JSON definition.',
        };
    }

    @Get('diagnostics/stats')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserType.ADMIN)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get catalog health stats: item count, embedding coverage (admin only)' })
    async getStats() {
        return this.catalogService.getStats();
    }

    // ─── CRUD ────────────────────────────────────────────

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

