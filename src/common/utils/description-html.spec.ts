import { sanitizeDescription, textToParagraphs } from './description-html';

describe('product description HTML', () => {
  it('keeps the formatting the editor makes', () => {
    const html = '<p><strong>Hand-finished</strong> kaftan</p><ul><li>Lined collar</li><li><em>Cold wash</em></li></ul><h3>Fit</h3>';
    expect(sanitizeDescription(html)).toBe(html);
  });

  it('removes scripts, event handlers, styles and images', () => {
    const out = sanitizeDescription(
      '<p onclick="steal()">Hi<script>alert(1)</script></p><img src=x onerror="steal()"><style>p{}</style><iframe src="https://evil"></iframe><p style="color:red">ok</p>',
    );
    expect(out).toBe('<p>Hi</p><p>ok</p>');
    expect(out).not.toMatch(/script|onerror|onclick|img|style|iframe/i);
  });

  it('keeps safe links, opening in a new tab without referrer, and drops javascript: links', () => {
    expect(sanitizeDescription('<p><a href="https://qlozet.app/care">care</a></p>')).toBe(
      '<p><a href="https://qlozet.app/care" target="_blank" rel="nofollow noopener noreferrer">care</a></p>',
    );
    expect(sanitizeDescription('<p><a href="javascript:steal()">x</a></p>')).not.toContain('javascript');
  });

  it('turns plain text into paragraphs, keeping line breaks', () => {
    expect(textToParagraphs('Heavy cotton.\n\nWashes cold.\nIron on reverse.')).toBe(
      '<p>Heavy cotton.</p><p>Washes cold.<br>Iron on reverse.</p>',
    );
    expect(sanitizeDescription('5 < 6 & "quotes"')).toBe('<p>5 &lt; 6 &amp; "quotes"</p>');
  });

  it('leaves an empty description empty', () => {
    expect(sanitizeDescription('')).toBe('');
    expect(sanitizeDescription(null)).toBe('');
  });
});
