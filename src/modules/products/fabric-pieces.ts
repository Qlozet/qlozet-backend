import { BadRequestException } from '@nestjs/common';

/**
 * Selling fabric by the piece.
 *
 * Much fabric is sold in fixed lengths: Ankara by the 6-yard piece, lace in
 * 5-yard pieces, aso-oke and George as sets. A vendor chooses how a fabric is
 * sold:
 *   - 'yard'  (default): any length from the minimum cut up, priced per yard.
 *   - 'piece': whole pieces only (piece_yards long, piece_price each).
 *   - 'both':  either, so the cheaper full piece can show beside the per-yard price.
 *
 * Yards stay the unit underneath: stock is yard_length, a piece purchase is
 * stored as yardage = piece_yards × quantity = pieces, so stock deduction,
 * restore and availability need no changes. For a piece-only fabric,
 * price_per_yard is kept as piece_price / piece_yards, so every yard-based
 * reading (garment pricing, displays, analytics) stays sensible; whole pieces
 * are enforced only where a customer buys the fabric itself.
 */

export type FabricSoldBy = 'yard' | 'piece' | 'both';

export interface PieceFields {
  name?: string;
  sold_by?: string | null;
  piece_yards?: number | null;
  piece_price?: number | null;
  price_per_yard?: number | null;
  min_cut?: number | null;
  yard_length?: number | null;
}

export const soldBy = (f?: PieceFields | null): FabricSoldBy =>
  f?.sold_by === 'piece' || f?.sold_by === 'both' ? f.sold_by : 'yard';

/** Has usable piece settings and the vendor sells by the piece. */
export const sellsPieces = (f?: PieceFields | null): boolean =>
  soldBy(f) !== 'yard' &&
  Number(f?.piece_yards) > 0 &&
  Number(f?.piece_price) > 0;

/** Only whole pieces can be bought. */
export const piecesOnly = (f?: PieceFields | null): boolean =>
  soldBy(f) === 'piece' && sellsPieces(f);

const money = (n: number) => Math.round(n * 100) / 100;

export interface FabricPurchase {
  /** Yards per unit, as stored on the selection. */
  yardage: number;
  /** Units: pieces in piece mode, cuts in yard mode. */
  quantity: number;
  pieces: number | null;
  totalYards: number;
  cost: number;
}

/**
 * Price and check one selection of a fabric product itself. Piece mode when
 * the selection names `pieces`; yard mode otherwise (refused for a fabric sold
 * only by the piece). Yard-mode rules (minimum cut, stock) stay where they
 * were; this applies the piece-mode ones.
 */
export function resolveFabricPurchase(
  f: PieceFields,
  sel: { yardage?: number | null; quantity?: number | null; pieces?: number | null },
): FabricPurchase {
  const pieces = Number(sel.pieces);
  if (pieces > 0) {
    if (!sellsPieces(f)) {
      throw new BadRequestException(`${f.name || 'This fabric'} is not sold by the piece.`);
    }
    if (!Number.isInteger(pieces)) {
      throw new BadRequestException('Choose a whole number of pieces.');
    }
    const pieceYards = Number(f.piece_yards);
    const totalYards = pieces * pieceYards;
    if ((f.yard_length ?? 0) < totalYards) {
      const left = Math.floor((f.yard_length ?? 0) / pieceYards);
      throw new BadRequestException(
        left > 0
          ? `Only ${left} piece${left === 1 ? '' : 's'} of ${f.name || 'this fabric'} left.`
          : `${f.name || 'This fabric'} is sold out.`,
      );
    }
    return {
      yardage: pieceYards,
      quantity: pieces,
      pieces,
      totalYards,
      cost: money(pieces * Number(f.piece_price)),
    };
  }
  if (piecesOnly(f)) {
    throw new BadRequestException(
      `${f.name || 'This fabric'} is sold by the ${f.piece_yards}-yard piece. Choose how many pieces.`,
    );
  }
  const yardage = Number(sel.yardage) || 0;
  const quantity = Number(sel.quantity) || 1;
  return {
    yardage,
    quantity,
    pieces: null,
    totalYards: yardage * quantity,
    cost: money(yardage * Number(f.price_per_yard || 0) * quantity),
  };
}

/**
 * The yards a garment or design needs, as the customer can actually buy
 * them: rounded up to whole pieces for a piece-only fabric (a 4-yard need
 * from 6-yard pieces buys one piece), unchanged otherwise.
 */
export function roundToSellable(
  f: PieceFields | null | undefined,
  yards: number,
): { yards: number; pieces: number | null; cost: number } {
  if (f && piecesOnly(f) && yards > 0) {
    const pieceYards = Number(f.piece_yards);
    const pieces = Math.ceil(yards / pieceYards - 1e-9);
    return {
      yards: pieces * pieceYards,
      pieces,
      cost: money(pieces * Number(f.piece_price)),
    };
  }
  return {
    yards,
    pieces: null,
    cost: money(yards * Number(f?.price_per_yard || 0)),
  };
}

/**
 * Normalise a fabric definition as a vendor or admin saves it: validate the
 * piece settings and, for a piece-only fabric, derive the per-yard price and
 * minimum cut from the piece. Returns the base price the product should
 * carry (what listings show and sort by): the piece price for piece-only,
 * else the per-yard price. Mutates `fabric`.
 */
export function normaliseFabricPieces(fabric: any): number | null {
  if (!fabric) return null;
  const mode = soldBy(fabric);
  fabric.sold_by = mode;
  if (mode === 'yard') {
    return null;
  }
  const pieceYards = Number(fabric.piece_yards);
  const piecePrice = Number(fabric.piece_price);
  if (!(pieceYards > 0)) {
    throw new BadRequestException('Enter how many yards are in one piece.');
  }
  if (!(piecePrice > 0)) {
    throw new BadRequestException('Enter the price of one piece.');
  }
  fabric.piece_yards = pieceYards;
  fabric.piece_price = piecePrice;
  if (mode === 'piece') {
    fabric.price_per_yard = money(piecePrice / pieceYards);
    fabric.min_cut = pieceYards;
    return piecePrice;
  }
  return null;
}
