import sanitizeHtml from 'sanitize-html';

/**
 * A product description as the shop shows it: safe, formatted HTML.
 *
 * Descriptions are displayed as HTML in the shop and the admin preview, so a
 * description holding a script would run for every shopper who opened the
 * product. On every save it is cleaned down to the formatting the vendor
 * editor produces (paragraphs, bold, italics, underline, strike, lists,
 * headings, quotes, safe links). No images (photos go in the gallery), no
 * styles, no scripts or event handlers.
 *
 * Plain text (older fabric and accessory descriptions, or any client that
 * sends a text box) becomes paragraphs, so its line breaks survive instead of
 * running together. Keep the allow-list in step with the apps' renderers
 * (shop lib/description-html.ts, vendor and admin lib/description-html.ts).
 */
export const DESCRIPTION_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li',
  'h2', 'h3', 'h4', 'blockquote', 'a',
];

const looksLikeHtml = (s: string) => /<\/?[a-z][\s\S]*?>/i.test(s);

const escapeText = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain text to paragraphs: blank lines split paragraphs, single breaks stay. */
export function textToParagraphs(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeText(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function sanitizeDescription(input: unknown): string {
  if (input === null || input === undefined) return '';
  const raw = String(input);
  if (!raw.trim()) return '';
  const html = looksLikeHtml(raw) ? raw : textToParagraphs(raw);
  return sanitizeHtml(html, {
    allowedTags: DESCRIPTION_TAGS,
    allowedAttributes: { a: ['href', 'title', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        target: '_blank',
        rel: 'nofollow noopener noreferrer',
      }),
    },
    // Drop the contents of these, not just the tags.
    nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe', 'object', 'embed'],
  }).trim();
}
