import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductDocument, Product } from '../src/modules/products/schemas';

async function bootstrap() {
  process.env.SHIPBUBBLE_BASE_URL = 'http://dummy.com';
  process.env.SHIPBUBBLE_API_KEY = 'dummy';
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
  process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/qlozet';
  
  const app = await NestFactory.createApplicationContext(AppModule);

  const eventEmitter = app.get(EventEmitter2);
  const productModel = app.get<Model<ProductDocument>>(getModelToken(Product.name));

  console.log('🚀 Starting catalog backfill...');

  try {
    const products = await productModel.find().lean();
    console.log(`Found ${products.length} products to sync.`);

    let count = 0;
    for (const product of products) {
      // Fire the same event that ProductService now fires on upsert
      eventEmitter.emit('product.upserted', product);
      count++;
    }

    // Wait a little bit for async event handlers to finish
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log(`✅ Emitted sync events for ${count} products!`);
  } catch (error) {
    console.error('❌ Error during backfill:', error.message);
  } finally {
    await app.close();
    process.exit(0);
  }
}

bootstrap();
