/**
 * The generator gets every picture as one unlabelled list. A customer's
 * reference outfit and the fabric they picked look alike to it, so it would
 * keep the reference's fabric or blend the two. Put the fabrics first and say
 * in the prompt which picture is which.
 *
 * A two-piece set can have a second fabric for its bottom (trousers or a
 * skirt). It goes in as its own picture: described only in words, its print
 * was lost.
 */
export type ImageRole = 'fabric' | 'bottom_fabric' | 'style';

export interface GenerationImages {
  urls: string[];
  roles: { index: number; role: ImageRole }[];
  /** Sentences for the prompt naming each picture's job; empty when there are none. */
  note: string;
}

export function orderGenerationImages(params: {
  referenceUrls: string[];
  metadataRefs: string[];
  fabricUrl?: string | null;
  /** A two-piece set's bottom fabric, when it differs from the top's. */
  bottomFabricUrl?: string | null;
  /** What the set's bottom is ('trousers' or 'skirt'); set only for a two-piece set. */
  bottomPiece?: string | null;
}): GenerationImages {
  const fabric = params.fabricUrl || null;
  const bottomFabric =
    params.bottomFabricUrl && params.bottomFabricUrl !== fabric ? params.bottomFabricUrl : null;
  const bottom = params.bottomPiece || (bottomFabric ? 'bottom' : null);
  const style = Array.from(new Set([...params.referenceUrls, ...params.metadataRefs])).filter(
    (u) => !!u && u !== fabric && u !== bottomFabric,
  );

  const ordered: { url: string; role: ImageRole }[] = [
    ...(fabric ? [{ url: fabric, role: 'fabric' as const }] : []),
    ...(bottomFabric ? [{ url: bottomFabric, role: 'bottom_fabric' as const }] : []),
    ...style.map((url) => ({ url, role: 'style' as const })),
  ];
  const urls = ordered.map((o) => o.url);
  const roles = ordered.map((o, i) => ({ index: i + 1, role: o.role }));

  const only = ordered.length === 1;
  const name = (i: number) => (only ? 'The image' : `Image ${i}`);
  const exact = 'matching its pattern, print, colours, scale and texture exactly';
  const parts: string[] = [];

  if (fabric) {
    if (bottomFabric) {
      parts.push(`${name(1)} is the TOP's fabric: make the top from it, ${exact}.`);
    } else if (bottom) {
      parts.push(
        `${name(1)} is the FABRIC: make both the top and the ${bottom} from it, ${exact}, ` +
          'with the pattern at the same scale on both pieces.',
      );
    } else {
      parts.push(`${name(1)} is the FABRIC: make the whole garment from it, ${exact}.`);
    }
  }
  if (bottomFabric) {
    const i = fabric ? 2 : 1;
    parts.push(
      `${name(i)} is the ${bottom!.toUpperCase()}'s fabric: make the ${bottom} from it, ${exact}.` +
        (fabric
          ? ` Keep the two fabrics apart: none of image ${i}'s pattern on the top, none of image 1's on the ${bottom}.`
          : ` Do not use it for the top.`),
    );
  }
  if (style.length) {
    const first = ordered.length - style.length + 1;
    const range = only
      ? 'The image is a style reference'
      : style.length === 1
        ? `Image ${first} is a style reference`
        : `Images ${first} to ${ordered.length} are style references`;
    parts.push(
      fabric || bottomFabric
        ? `${range}: copy the garment's shape, cut, sleeves, collar, closures and details from ` +
            (style.length === 1 ? 'it' : 'them') +
            ', but NOT its fabric, colours or pattern; those come only from the fabric images.'
        : `${range}: copy the garment's shape, cut and details. ` +
            'Keep the reference fabric only when no other fabric or colour is asked for.',
    );
  }
  return { urls, roles, note: parts.join(' ') };
}
