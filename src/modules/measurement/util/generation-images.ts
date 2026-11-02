/**
 * The generator gets every picture as one unlabelled list. A customer's
 * reference outfit and the fabric they picked look alike to it, so it would
 * keep the reference's fabric or blend the two. Put the fabric first and say
 * in the prompt which picture is which.
 */
export type ImageRole = 'fabric' | 'style';

export interface GenerationImages {
  urls: string[];
  roles: { index: number; role: ImageRole }[];
  /** A sentence for the prompt naming each picture's job; empty when there are none. */
  note: string;
}

export function orderGenerationImages(params: {
  referenceUrls: string[];
  metadataRefs: string[];
  fabricUrl?: string | null;
}): GenerationImages {
  const fabric = params.fabricUrl || null;
  const style = Array.from(new Set([...params.referenceUrls, ...params.metadataRefs])).filter(
    (u) => !!u && u !== fabric,
  );
  const urls = fabric ? [fabric, ...style] : style;
  const roles = urls.map((_, i) => ({
    index: i + 1,
    role: (fabric && i === 0 ? 'fabric' : 'style') as ImageRole,
  }));

  const styleRange =
    style.length === 0
      ? ''
      : fabric
        ? style.length === 1
          ? 'Image 2 is a style reference'
          : `Images 2 to ${style.length + 1} are style references`
        : style.length === 1
          ? 'The image is a style reference'
          : 'The images are style references';

  let note = '';
  if (fabric) {
    note =
      `${style.length ? 'Image 1' : 'The image'} is the FABRIC: make the whole garment from it, ` +
      'matching its pattern, colours, scale and texture exactly.';
    if (style.length) {
      note +=
        ` ${styleRange}: copy the garment's shape, cut, sleeves, collar, closures and details from ` +
        (style.length === 1 ? 'it' : 'them') +
        ', but NOT its fabric, colours or pattern; those come only from image 1.';
    }
  } else if (style.length) {
    note =
      `${styleRange}: copy the garment's shape, cut and details. ` +
      'Keep the reference fabric only when no other fabric or colour is asked for.';
  }
  return { urls, roles, note };
}
