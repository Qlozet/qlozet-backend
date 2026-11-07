// The contact name Shipbubble accepts on an address: a full name of at least
// two words, letters only. Live Shipbubble refuses anything else ("Please
// provide a full name (e.g John Doe), please remove all numbers and
// symbols"), and vendors' addresses were sent with the store name —
// "BantuBlue", "Beebo_ng" — so no store could save its address.
//
// Takes candidates in order of preference (the owner's name before the store
// name) and returns the first that makes a valid full name once cleaned.

function clean(raw: unknown): string[] {
  return String(raw ?? '')
    // a word with a digit in it ("2nd", "No.5") is not part of a name
    .replace(/\S*\d\S*/g, ' ')
    // "BantuBlue" → "Bantu Blue"
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    // digits, underscores, punctuation, emoji → space
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

export function shipbubbleContactName(...candidates: unknown[]): string {
  let firstWord: string | null = null;
  for (const c of candidates) {
    const words = clean(c);
    if (words.length >= 2) return words.slice(0, 4).join(' ');
    if (words.length === 1 && !firstWord) firstWord = words[0];
  }
  // One word is not a full name to Shipbubble.
  return firstWord ? `${firstWord} Store` : 'Qlozet Vendor';
}
