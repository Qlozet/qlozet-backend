import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomBytes } from 'crypto';

/**
 * The body scan sends only silhouettes — black-and-white outlines the phone
 * cuts out itself — never a photo or a video. Even those are not stored: the
 * upload holds them here, in memory, until the queued job hands them to the
 * measurement model, and they are dropped when the job ends (or on a timer).
 *
 * Memory only, so the worker must run in the process that took the upload.
 * True today (one always-on Fly machine running both); a second machine
 * would need the job pinned to it.
 */

/** A silhouette lives this long at most, finished or not. */
export const SCAN_FILE_TTL_MS = 10 * 60 * 1000;
/** Refuse new scans past this much held (silhouettes are a few KB each). */
export const SCAN_FILE_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

interface Entry {
  buffer: Buffer;
  expires: number;
}

@Injectable()
export class ScanFileStore implements OnModuleDestroy {
  private readonly files = new Map<string, Entry>();
  private readonly sweep: NodeJS.Timeout;

  constructor() {
    this.sweep = setInterval(() => this.dropExpired(), 60 * 1000);
    this.sweep.unref?.();
  }

  onModuleDestroy() {
    clearInterval(this.sweep);
    this.files.clear();
  }

  /** Room for this many more bytes? */
  hasRoom(bytes: number): boolean {
    this.dropExpired();
    let held = 0;
    for (const e of this.files.values()) held += e.buffer.length;
    return held + bytes <= SCAN_FILE_MAX_TOTAL_BYTES;
  }

  put(buffer: Buffer, now = Date.now()): string {
    const token = randomBytes(24).toString('base64url');
    this.files.set(token, { buffer, expires: now + SCAN_FILE_TTL_MS });
    return token;
  }

  get(token: string | null | undefined, now = Date.now()): Buffer | null {
    if (!token) return null;
    const e = this.files.get(token);
    if (!e) return null;
    if (e.expires <= now) {
      this.files.delete(token);
      return null;
    }
    return e.buffer;
  }

  release(tokens: (string | null | undefined)[]) {
    for (const t of tokens) if (t) this.files.delete(t);
  }

  size() {
    return this.files.size;
  }

  private dropExpired(now = Date.now()) {
    for (const [t, e] of this.files) if (e.expires <= now) this.files.delete(t);
  }
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Silhouettes come as PNG; anything else is refused. */
export function isPng(buffer: Buffer | undefined | null): boolean {
  return !!buffer && buffer.length > PNG_MAGIC.length && buffer.subarray(0, 8).equals(PNG_MAGIC);
}
