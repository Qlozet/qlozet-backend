// scripts/seed.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SeedService } from '../src/modules/ums/services/seed.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const seedService = app.get(SeedService);
  const action = process.argv[2] || 'run';

  try {
    switch (action) {
      case 'run':
        console.log('🚀 Starting database seeding...');
        await seedService.seed();
        console.log('✅ Database seeding completed successfully!');
        break;

      case 'clear':
        console.log('🗑️  Clearing database...');
        await seedService.clearDatabase();
        console.log('✅ Database cleared successfully!');
        break;

      case 'permissions':
        console.log('🔐 Seeding permissions...');
        await seedService.seedPermissionsOnly();
        console.log('✅ Permissions seeded successfully!');
        break;

      case 'roles':
        console.log('🎭 Seeding roles...');
        await seedService.seedRolesOnly();
        console.log('✅ Roles seeded successfully!');
        break;

      case 'users':
        console.log('👥 Seeding users...');
        await seedService.seedUsersOnly();
        console.log('✅ Users seeded successfully!');
        break;

      default:
        console.log(
          '❌ Unknown action. Available actions: run, clear, permissions, roles, users',
        );
        process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await app.close();
  }
}

bootstrap();
