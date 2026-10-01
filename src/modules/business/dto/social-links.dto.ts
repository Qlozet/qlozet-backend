import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Hosts a vendor might paste instead of a handle. Each platform's profile URL
 * is `https://<host>/<handle>`, so stripping a known prefix leaves the handle.
 */
const PROFILE_HOSTS = [
  'instagram.com',
  'twitter.com',
  'x.com',
  'pinterest.com',
  'youtube.com',
  'tiktok.com',
];

/**
 * Reduce whatever the vendor typed to a bare handle.
 *
 * Handles are stored, not URLs, for two reasons: the link is then built by us
 * and always points at the real platform — a stored URL is an open redirect
 * sitting on a vendor's storefront — and a handle can be displayed, compared
 * and one day verified, which an arbitrary URL cannot.
 *
 * Accepts "@kemi", "kemi", "instagram.com/kemi", a full https URL with a
 * trailing slash or an ?igsh= tracking query, and the "@kemi" form TikTok and
 * YouTube use inside their own URLs.
 */
export const toHandle = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

  let handle = value.trim();
  if (!handle) return undefined; // an emptied field clears the link

  handle = handle.replace(/^https?:\/\//i, '').replace(/^www\./i, '');

  let strippedKnownHost = false;
  for (const host of PROFILE_HOSTS) {
    if (handle.toLowerCase().startsWith(`${host}/`)) {
      handle = handle.slice(host.length + 1);
      strippedKnownHost = true;
      break;
    }
  }

  // Only reach into a path when we know whose path it is. A URL on some other
  // host is returned untouched so that its slash fails validation and the
  // vendor is told it is not a profile link - reducing it to its first
  // segment would quietly store "evil.example.com" as a handle, which passes
  // the pattern (dots are legal in handles) and renders as a dead link.
  if (!strippedKnownHost && handle.includes('/')) return handle;

  // Drop any query or fragment, a trailing slash, then deeper path segments,
  // then the leading @.
  handle = handle.split(/[?#]/)[0].replace(/\/+$/, '').split('/')[0];
  handle = handle.replace(/^@+/, '');

  return handle || undefined;
};

/**
 * Every one of these platforms allows letters, digits, dot, underscore and
 * hyphen. Anything else means a URL survived normalisation, or the vendor
 * typed a sentence into the field.
 */
const HANDLE_PATTERN = /^[A-Za-z0-9._-]+$/;

export class SocialLinksDto {
  @ApiPropertyOptional({ example: 'kemicouture', description: 'Instagram handle' })
  @IsOptional()
  @Transform(({ value }) => toHandle(value))
  @IsString()
  @MaxLength(64)
  @Matches(HANDLE_PATTERN, {
    message: 'Instagram must be a handle, e.g. kemicouture',
  })
  instagram?: string;

  @ApiPropertyOptional({ example: 'kemicouture', description: 'Twitter / X handle' })
  @IsOptional()
  @Transform(({ value }) => toHandle(value))
  @IsString()
  @MaxLength(64)
  @Matches(HANDLE_PATTERN, {
    message: 'Twitter must be a handle, e.g. kemicouture',
  })
  twitter?: string;

  @ApiPropertyOptional({ example: 'kemicouture', description: 'Pinterest handle' })
  @IsOptional()
  @Transform(({ value }) => toHandle(value))
  @IsString()
  @MaxLength(64)
  @Matches(HANDLE_PATTERN, {
    message: 'Pinterest must be a handle, e.g. kemicouture',
  })
  pinterest?: string;

  @ApiPropertyOptional({ example: 'kemicouture', description: 'YouTube handle' })
  @IsOptional()
  @Transform(({ value }) => toHandle(value))
  @IsString()
  @MaxLength(64)
  @Matches(HANDLE_PATTERN, {
    message: 'YouTube must be a handle, e.g. kemicouture',
  })
  youtube?: string;

  @ApiPropertyOptional({ example: 'kemicouture', description: 'TikTok handle' })
  @IsOptional()
  @Transform(({ value }) => toHandle(value))
  @IsString()
  @MaxLength(64)
  @Matches(HANDLE_PATTERN, {
    message: 'TikTok must be a handle, e.g. kemicouture',
  })
  tiktok?: string;
}
