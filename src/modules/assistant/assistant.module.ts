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
import { User, UserSchema } from '../ums/schemas/user.schema';
import { Business, BusinessSchema } from '../business/schemas/business.schema';
import { Ticket, TicketSchema } from '../ticket/schema/ticket.schema';
import { Dispute, DisputeSchema } from '../disputes/schemas/dispute.schema';
import { Return, ReturnSchema } from '../returns/schemas/return.schema';
import { BespokeQuote, BespokeQuoteSchema } from '../bespoke/schemas/bespoke-quote.schema';
import { BespokeDesign, BespokeDesignSchema } from '../bespoke/schemas/bespoke-design.schema';
import { Event, EventSchema } from '../recommendations/events/schemas/event.schema';
import {
  TokenTransaction,
  TokenTransactionSchema,
} from '../wallets/schema/token.schema';
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
import { VendorOpsToolsService } from './tools/vendor-ops-tools.service';
import { VendorActionsService } from './actions/vendor-actions.service';
import { AssistantAction, AssistantActionSchema } from './schema/action.schema';
import { OrdersModule } from '../orders/orders.module';
import { ProductModule } from '../products/products.module';
import { BespokeModule } from '../bespoke/bespoke.module';
import { AdminAnalyticsToolsService } from './tools/admin-analytics-tools.service';
import { AssistantDigestService } from './assistant-digest.service';
import { AssistantDigestCron } from './assistant-digest.cron';
import { ClaudeProvider } from './llm/claude.provider';
import { AnthropicAuthService } from './llm/anthropic-auth.service';
import { LLM_PROVIDER } from './llm/llm-provider.interface';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: BusinessEarning.name, schema: BusinessEarningSchema },
      { name: Wallet.name, schema: WalletSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Product.name, schema: ProductSchema },
      { name: User.name, schema: UserSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Ticket.name, schema: TicketSchema },
      { name: Dispute.name, schema: DisputeSchema },
      { name: Return.name, schema: ReturnSchema },
      { name: BespokeQuote.name, schema: BespokeQuoteSchema },
      { name: BespokeDesign.name, schema: BespokeDesignSchema },
      { name: Event.name, schema: EventSchema },
      { name: TokenTransaction.name, schema: TokenTransactionSchema },
      { name: AssistantConversation.name, schema: AssistantConversationSchema },
      { name: AssistantDigest.name, schema: AssistantDigestSchema },
      { name: AssistantAction.name, schema: AssistantActionSchema },
    ]),
    HttpModule,
    WalletsModule, // provides TokenService (ai_ask metering)
    // The services the prepared actions execute through - the same ones the
    // dashboard calls, so their rules apply to the assistant too.
    OrdersModule,
    ProductModule,
    BespokeModule,
  ],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    AnalyticsToolsService,
    VendorOpsToolsService,
    VendorActionsService,
    AdminAnalyticsToolsService,
    AssistantDigestService,
    AssistantDigestCron,
    JwtService,
    // Swappable LLM binding — everything depends on LLM_PROVIDER, not Claude.
    AnthropicAuthService,
    { provide: LLM_PROVIDER, useClass: ClaudeProvider },
  ],
  exports: [AssistantService, AssistantDigestService],
})
export class AssistantModule {}
