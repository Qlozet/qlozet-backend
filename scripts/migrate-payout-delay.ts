// scripts/migrate-payout-delay.ts
//
// One-off migration: align stored PlatformSettings.payout_delay_days with the
// new default (3). The code default only applies to freshly-created settings
// documents, so any existing document created with the old value of 7 must be
// updated here.
//
// Usage:
//   npx ts-node scripts/migrate-payout-delay.ts          # sets payout_delay_days = 3
//   npx ts-node scripts/migrate-payout-delay.ts 5        # sets a custom value
//
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import {
  PlatformSettings,
  PlatformSettingsDocument,
} from '../src/modules/platform/schema/platformSettings.schema';

async function bootstrap() {
  const target = Number(process.argv[2] ?? 3);

  if (!Number.isFinite(target) || target < 0) {
    console.error(`❌ Invalid payout_delay_days value: "${process.argv[2]}"`);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const model = app.get<Model<PlatformSettingsDocument>>(
      getModelToken(PlatformSettings.name),
    );

    const existing = await model.find({}, 'payout_delay_days').lean();

    if (existing.length === 0) {
      console.log(
        'ℹ️  No PlatformSettings document found. Nothing to migrate ' +
          `(new documents will use the code default of ${target}).`,
      );
      return;
    }

    console.log(
      `📋 Found ${existing.length} settings document(s). Current payout_delay_days: ` +
        existing.map((d) => d.payout_delay_days).join(', '),
    );

    const result = await model.updateMany(
      { payout_delay_days: { $ne: target } },
      { $set: { payout_delay_days: target } },
    );

    console.log(
      `✅ Updated ${result.modifiedCount} document(s) → payout_delay_days = ${target}.`,
    );
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

bootstrap();
