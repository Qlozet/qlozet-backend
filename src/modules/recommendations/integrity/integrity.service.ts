import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CatalogItem, CatalogItemDocument } from '../catalog/schemas/catalog-item.schema';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { BusinessService } from '../../business/business.service';
import { UserEmbeddingsService } from '../user-embeddings/user-embeddings.service';

@Injectable()
export class IntegrityService {
    private readonly logger = new Logger(IntegrityService.name);

    constructor(
        @InjectModel(CatalogItem.name) private catalogModel: Model<CatalogItemDocument>,
        private embeddingService: EmbeddingsService,
        private businessService: BusinessService, // Ideally needs a method to check many businesses
        private userEmbeddingsService: UserEmbeddingsService
    ) { }

    @Cron(CronExpression.EVERY_WEEK)
    async runWeeklyChecks() {
        this.logger.log('Starting Weekly Integrity Checks...');
        const report = await this.generateIntegrityReport();
        this.logger.log(`Integrity Report: ${JSON.stringify(report, null, 2)}`);
        // Optionally alert via email/slack here
    }

    async generateIntegrityReport() {
        return {
            missingEmbeddings: await this.checkEmbeddingsIntegrity(),
            vendorIssues: await this.checkVendorIntegrity(),
            userCoverage: await this.checkUserEmbeddingsCoverage(),
        };
    }

    async checkEmbeddingsIntegrity() {
        const count = await this.catalogModel.countDocuments({
            $or: [
                { 'embeddings.e_style': { $exists: false } },
                { 'embeddings.e_fabric': { $exists: false } }
            ]
        });
        return { count, status: count > 0 ? 'WARNING' : 'OK' };
    }

    // This is expensive if we iterate all items. Better to sample or aggregate.
    async checkVendorIntegrity() {
        // Find distinct vendors in catalog
        const vendors = await this.catalogModel.distinct('vendor').exec();
        let invalidCount = 0;
        let inactiveCount = 0;

        // Limiting check to first 100 for performance safety in this demo implementation
        const sampleVendors = vendors.slice(0, 100);

        for (const vendorId of sampleVendors) {
            const business = await this.businessService.findOne(vendorId);
            if (!business) {
                invalidCount++;
            } else if (!business.is_active || (business.status !== 'approved' && business.status !== 'verified')) {
                inactiveCount++;
            }
        }

        return {
            totalVendors: vendors.length,
            checked: sampleVendors.length,
            invalidVendors: invalidCount,
            inactiveVendors: inactiveCount
        };
    }

    async checkUserEmbeddingsCoverage() {
        // This requires access to User model effectively, or UserEmbeddings model
        // Assuming userEmbeddingsService has a model access or we check logic
        // For now, let's mock the check as "Not Implemented properly without User Model access in this service scope directly"
        // But we can check if userEmbeddingsService can provide stats.
        return { message: "User coverage check requires User Model direct access" };
    }
}
