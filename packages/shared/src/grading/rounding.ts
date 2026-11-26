/**
 * Decimal rounding without floating-point surprises.
 *
 * A double like 9.0375 is really 9.037499999999999… in binary, so `Math.round(x * 10000)` can
 * round the wrong way. Here the number is first written with 15 significant digits (the precision
 * Excel shows), which removes the binary noise, and then rounded with integer (BigInt) arithmetic
 * on that decimal string. Ties go away from zero, like Excel's ROUND.
 */

function decimalParts(x: number): { negative: boolean; digits: bigint; scale: number } | null {
  const text = Math.abs(x).toPrecision(15);
  if (text.includes('e')) return null; // < 1e-6 or > 1e21: not a grade
  const [integer = '0', fraction = ''] = text.split('.');
  return { negative: x < 0, digits: BigInt(integer + fraction), scale: fraction.length };
}

/** Rounds to `decimals` places, half away from zero (Excel ROUND). */
export function roundTo(x: number, decimals: number): number {
  if (!Number.isFinite(x)) throw new RangeError(`No se puede redondear ${x}`);
  if (!Number.isInteger(decimals) || decimals < 0) throw new RangeError('Decimales inválidos');
  const parts = decimalParts(x);
  if (!parts) return Math.abs(x) < 1 ? 0 : x;
  if (parts.scale <= decimals) return x;
  const divisor = 10n ** BigInt(parts.scale - decimals);
  let quotient = parts.digits / divisor;
  if ((parts.digits % divisor) * 2n >= divisor) quotient += 1n;
  // Number("90375e-4") gives the double closest to 9.0375.
  const result = Number(`${quotient}e-${decimals}`);
  return parts.negative && result !== 0 ? -result : result;
}

/**
 * Section 5, step 3: first to `preDecimals` (4) places, then to an integer with .5 up.
 * 9.4999999 → 9.5 → 10;  8.45 → 8.45 → 8;  9.0375 → 9.0375 → 9.
 */
export function roundHalfUp(x: number, preDecimals = 4): number {
  return roundTo(roundTo(x, preDecimals), 0);
}
