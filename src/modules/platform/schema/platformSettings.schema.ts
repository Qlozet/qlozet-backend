import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class PlatformSettings extends Document {
  @Prop({
    type: String,
    enum: ['weekly', 'bi-weekly', 'monthly'],
    default: 'weekly',
  })
  payout_cycle: string;

  @Prop({ type: Number, default: 2000 })
  minimum_payout: number;

  @Prop({ type: Number, default: 3 })
  payout_delay_days: number;

  // Safety net: auto-release completion earnings this many days after DISPATCH
  // (shipped_at) if the delivery webhook never fires (see BusinessEarningsCron).
  @Prop({ type: Number, default: 10 })
  auto_release_days: number;

  @Prop({ type: Number, default: 5 })
  late_penalty_percent_per_day: number;

  @Prop({ type: Number, default: 25 })
  late_penalty_max_percent: number;

  @Prop({ type: Number, default: 24 })
  auto_reject_hours: number;

  @Prop({ type: Number, default: 7 })
  return_window_days: number;

  @Prop({ type: Number, default: 10 })
  platform_commission_percent: number;

  // Commission can be a percentage of the item price, or a flat ₦ amount.
  @Prop({ type: String, enum: ['percent', 'fixed'], default: 'percent' })
  platform_commission_type: 'percent' | 'fixed';

  @Prop({ type: Number, default: 0 })
  platform_commission_flat: number;

  @Prop({ type: Number, default: 0 })
  payment_handling_fee_percent: number;

  @Prop({ type: Number, default: 0 })
  payment_handling_fee_flat: number;

  @Prop({ type: Number, default: 0 })
  tax_percent: number;
  @Prop({ type: Number, default: 25 })
  image_measurement_token_price: number;

  @Prop({ type: Number, default: 45 })
  video_measurement_token_price: number;

  @Prop({ type: Number, default: 45 })
  outfit_generation_token_price: number;

  @Prop({ type: Number, default: 45 })
  edit_garment_token_price: number;

  @Prop({ type: Number, default: 45 })
  run_prediction_token_price: number;

  @Prop({ type: Number, default: 0 })
  ai_ask_token_price: number;

  @Prop({ type: Number, default: 10 })
  analyze_reference_token_price: number;

  @Prop({ type: Boolean, default: false })
  ai_ask_requires_auth: boolean;

  // ── Token rewards (0 = reward off) ──
  // Registration previously hardcoded 100 tokens; the default preserves that.
  @Prop({ type: Number, default: 100 })
  customer_signup_token_reward: number;

  // Granted once, when the business is first approved (not at raw signup,
  // so throwaway registrations can't farm tokens). Registration previously
  // hardcoded 250 at signup; the default preserves that amount.
  @Prop({ type: Number, default: 250 })
  vendor_signup_token_reward: number;

  // Granted to the customer each time an order settles as paid.
  @Prop({ type: Number, default: 0 })
  order_payment_token_reward: number;

  @Prop({ type: Number, default: 0 })
  tailored_order_upfront_percent: number;

  @Prop({ type: Number, default: 10 })
  reservation_fee_percent: number;

  // Availability thresholds. A variant at/under `low_stock_threshold` units (or a
  // fabric with fewer than `low_fabric_yards` yards left) is flagged "low stock".
  @Prop({ type: Number, default: 5 })
  low_stock_threshold: number;

  @Prop({ type: Number, default: 0 })
  low_fabric_yards: number; // 0 → fall back to 2× the fabric's min_cut

  @Prop({
    type: {
      usd: {
        amount: { type: Number, default: 0.01 },
        currency: { type: String, default: 'USD' },
      },
      ngn: {
        amount: { type: Number, default: 15 },
        currency: { type: String, default: 'NGN' },
        last_updated: { type: Date, default: new Date() },
      },
    },
    default: {
      usd: { amount: 0.01, currency: 'USD' },
      ngn: { amount: 15, currency: 'NGN', last_updated: new Date() },
    },
  })
  token_price: {
    usd: { amount: number; currency: string };
    ngn: { amount: number; currency: string; last_updated: Date };
  };

  // ── Multi-currency (plan Phase 1) ──
  // Group/consolidation currency for platform revenue (Qlozet, Inc. parent).
  @Prop({ type: String, default: 'USD' })
  base_currency: string;

  // Currencies customers can browse/pay in. Launch: NGN + USD (GBP/EUR later —
  // adding one here is the whole rollout for display).
  @Prop({ type: [String], default: ['NGN', 'USD'] })
  supported_currencies: string[];

  // Spread over mid-market applied when locking a checkout FX rate.
  @Prop({ type: Number, default: 2 })
  fx_markup_percent: number;

  // Which processor charges each currency; `default` covers the rest.
  @Prop({ type: Object, default: { NGN: 'paystack', default: 'stripe' } })
  currency_processor_map: Record<string, string>;

  // Kill-switch: non-NGN routing refuses until Stripe (Phase 3) is live.
  @Prop({ type: Boolean, default: false })
  stripe_enabled: boolean;
}

export type PlatformSettingsDocument = PlatformSettings & Document;
export const PlatformSettingsSchema =
  SchemaFactory.createForClass(PlatformSettings);
