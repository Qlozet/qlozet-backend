// What the admin console's Waitlist page asks for, as plain functions so the
// rules are testable without Mongo.

import { BOT_FILTER } from './waitlist-bot';

export type WaitlistTypeFilter = 'all' | 'customer' | 'vendor';

export interface WaitlistQuery {
  type?: string;
  search?: string;
  /** 'people' (default) hides likely bots; 'bots' shows only them. */
  show?: string;
  page?: number;
  size?: number;
}

export const WAITLIST_MAX_PAGE_SIZE = 100;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** People only, or likely bots only (waitlist-bot.ts). */
export function botScope(show?: string): Record<string, unknown> {
  return show === 'bots' ? BOT_FILTER : { $nor: BOT_FILTER.$or };
}

/**
 * The Mongo filter for the page: people or bots, then type, then a search
 * across name, email or business.
 */
export function waitlistFilter(q: WaitlistQuery): Record<string, unknown> {
  const and: Record<string, unknown>[] = [botScope(q.show)];
  if (q.type === 'customer' || q.type === 'vendor') and.push({ type: q.type });
  const search = String(q.search ?? '').trim();
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    and.push({ $or: [{ fullName: rx }, { email: rx }, { businessName: rx }] });
  }
  return { $and: and };
}

export function waitlistPaging(q: WaitlistQuery) {
  const page = Math.max(1, Math.floor(Number(q.page) || 1));
  const size = Math.min(
    WAITLIST_MAX_PAGE_SIZE,
    Math.max(1, Math.floor(Number(q.size) || 25)),
  );
  return { page, size, skip: (page - 1) * size };
}

/**
 * Has this waitlist entry since made a real account? Matched by email and the
 * matching account type (one email can hold a shopping AND a store account).
 */
export function signedUpKey(email: string, type: string): string {
  return `${String(email).trim().toLowerCase()}|${type === 'vendor' ? 'vendor' : 'customer'}`;
}

export interface WaitlistRow {
  type: string;
  fullName: string;
  email: string;
  phoneNumber?: string | null;
  businessName?: string | null;
  businessType?: string | null;
  createdAt?: Date | string | null;
  signed_up: boolean;
  likely_bot?: boolean;
}

const CSV_COLUMNS: [string, (r: WaitlistRow) => unknown][] = [
  ['Type', (r) => r.type],
  ['Name', (r) => r.fullName],
  ['Email', (r) => r.email],
  ['Phone', (r) => r.phoneNumber],
  ['Business name', (r) => r.businessName],
  ['Business type', (r) => r.businessType],
  ['Joined', (r) => (r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '')],
  ['Signed up', (r) => (r.signed_up ? 'yes' : 'no')],
];

function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  // A cell starting with = + - @ runs as a formula in Excel/Sheets; these are
  // strangers' typed names, so neutralise it.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function waitlistCsv(rows: WaitlistRow[]): string {
  const lines = [CSV_COLUMNS.map(([h]) => h).join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map(([, get]) => csvCell(get(r))).join(','));
  // BOM so Excel reads naira signs and accents as UTF-8.
  return '﻿' + lines.join('\r\n') + '\r\n';
}
