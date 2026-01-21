import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Catalog')
@Controller('recommendations/catalog')
export class CatalogController {
    constructor(private readonly catalogService: CatalogService) { }

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
