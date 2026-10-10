/**
 * Blend a query vector with a taste vector: mostly what they asked for, a
 * little of who they are. Falls back to the query alone whenever the taste
 * vector is missing, empty, or the wrong shape, so a bad profile can never
 * make a search worse than no profile.
 */
export function blendVectors(
  primary: number[],
  secondary: number[] | null | undefined,
  weight: number,
): number[] {
  if (!secondary || secondary.length !== primary.length || weight <= 0) return primary;
  if (!secondary.some((x) => x !== 0)) return primary;
  const out = primary.map((v, i) => v * (1 - weight) + secondary[i] * weight);
  const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? out.map((v) => v / norm) : primary;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
