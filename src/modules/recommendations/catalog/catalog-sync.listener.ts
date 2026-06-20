import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CatalogService } from './catalog.service';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto';
import { CatalogItemType } from './enums/catalog-item-type.enum';
import { EmbeddingsService } from '../embeddings/embeddings.service';

@Injectable()
export class CatalogSyncListener {
  private readonly logger = new Logger(CatalogSyncListener.name);

  constructor(
    private readonly catalogService: CatalogService,
    private readonly embeddingsService: EmbeddingsService,
  ) {}

  @OnEvent('product.upserted')
  async handleProductUpsertedEvent(product: any) {
    this.logger.log(`Syncing product ${product._id} to catalog...`);
    try {
      let itemType = CatalogItemType.GARMENT;
      if (product.kind === 'fabric') itemType = CatalogItemType.FABRIC;
      if (product.kind === 'accessory') itemType = CatalogItemType.ACCESSORY;

      // Extract specific data based on kind
      let name = '';
      let tags: string[] = [];
      let fitType = '';
      let targetDemographic = 'unisex';

      if (product.kind === 'clothing' && product.clothing) {
        name = product.clothing.name || 'Unnamed Clothing';
        tags = [
          ...(product.clothing.taxonomy?.categories || []),
          ...(product.clothing.taxonomy?.attributes || []),
        ];
        fitType = product.clothing.taxonomy?.categories?.[0] || 'regular';
      } else if (product.kind === 'fabric' && product.fabric) {
        name = product.fabric.name || 'Unnamed Fabric';
        tags = [
          ...(product.fabric.taxonomy?.categories || []),
          ...(product.fabric.taxonomy?.attributes || []),
        ];
      } else if (product.kind === 'accessory' && product.accessory) {
        name = product.accessory.name || 'Unnamed Accessory';
        tags = [
          ...(product.accessory.taxonomy?.categories || []),
          ...(product.accessory.taxonomy?.attributes || []),
        ];
      }

      const dto: CreateCatalogItemDto = {
        itemId: product._id.toString(),
        type: itemType,
        name: name || 'Product Item',
        description: product.description || '',
        price: product.base_price || 0,
        currency: 'NGN', // Defaulting to NGN for Nigerian platform
        vendor: product.business ? product.business.toString() : 'Unknown',
        tags: tags.filter(Boolean),
        rawVendorData: product,
      };

      if (itemType === CatalogItemType.GARMENT) {
        dto.fitMeta = {
          fitType: fitType || 'regular',
          targetDemographic: targetDemographic || 'unisex',
          measurementsPoints: [],
        };
      }

      const existing = await this.catalogService.findById(dto.itemId);
      if (existing) {
        await this.catalogService.update(dto.itemId, dto as any);
        this.logger.debug(`Updated catalog item ${dto.itemId}`);
      } else {
        await this.catalogService.create(dto as any);
        this.logger.debug(`Created new catalog item ${dto.itemId}`);
      }

      // Auto-generate embedding (fire-and-forget)
      this.embeddingsService.embedSingleItem(dto.itemId).catch(err => {
        this.logger.warn(`Auto-embed failed for ${dto.itemId}: ${err.message}`);
      });
    } catch (error) {
      this.logger.error(`Failed to sync product ${product._id} to catalog`, error);
    }
  }

  @OnEvent('product.deleted')
  async handleProductDeletedEvent(payload: { id: string }) {
    this.logger.log(`Removing catalog item for deleted product ${payload.id}`);
    try {
      await this.catalogService.delete(payload.id);
      this.logger.debug(`Deleted catalog item ${payload.id}`);
    } catch (error) {
      this.logger.error(`Failed to delete catalog item ${payload.id}`, error);
    }
  }
}
