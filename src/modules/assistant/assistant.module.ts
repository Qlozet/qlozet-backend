import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { JwtService } from '@nestjs/jwt';

import { Order, OrderSchema } from '../orders/schemas/orders.schema';
import {
  BusinessEarning,
  BusinessEarningSchema,
} from '../business/schemas/business-earnings.schema';
import { Wallet, WalletSchema } from '../wallets/schema/wallet.schema';
import {
  Transaction,
  TransactionSchema,
} from '../transactions/schema/transaction.schema';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import {
  AssistantConversation,
  AssistantConversationSchema,
  AssistantDigest,
  AssistantDigestSchema,
} from './schema/conversation.schema';

import { WalletsModule } from '../wallets/wallets.module';

import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { AnalyticsToolsService } from './tools/analytics-tools.service';
import { AssistantDigestService } from './assistant-digest.service';
import { AssistantDigestCron } from './assistant-digest.cron';
import { ClaudeProvider } from './llm/claude.provider';
import { LLM_PROVIDER } from './llm/llm-provider.interface';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: BusinessEarning.name, schema: BusinessEarningSchema },
      { name: Wallet.name, schema: WalletSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Product.name, schema: ProductSchema },
      { name: AssistantConversation.name, schema: AssistantConversationSchema },
      { name: AssistantDigest.name, schema: AssistantDigestSchema },
    ]),
    HttpModule,
    WalletsModule, // provides TokenService (ai_ask metering)
  ],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    AnalyticsToolsService,
    AssistantDigestService,
    AssistantDigestCron,
    JwtService,
    // Swappable LLM binding — everything depends on LLM_PROVIDER, not Claude.
    { provide: LLM_PROVIDER, useClass: ClaudeProvider },
  ],
  exports: [AssistantService, AssistantDigestService],
})
export class AssistantModule {}
