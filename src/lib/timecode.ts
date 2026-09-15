/** Rational rates retain the difference between 24 fps and 24000/1001 fps. */
export interface FrameRate {
  numerator: number;
  denominator: number;
}

export type FrameRateInput = number | FrameRate;

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

export function normalizeFrameRate(input: FrameRateInput): FrameRate {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0 || input > 1000) {
      throw new RangeError('La tasa debe ser mayor que 0 y menor o igual que 1000 fps.');
    }
    for (const numerator of [24000, 30000, 48000, 60000, 120000]) {
      if (Math.abs(input - numerator / 1001) < 0.0006) {
        return { numerator, denominator: 1001 };
      }
    }
    const denominator = 1_000_000;
    const numerator = Math.round(input * denominator);
    if (numerator === 0) throw new RangeError('La tasa de fotogramas es demasiado pequeña.');
    const divisor = gcd(numerator, denominator);
    return { numerator: numerator / divisor, denominator: denominator / divisor };
  }
  const { numerator, denominator } = input;
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)
    || numerator <= 0 || denominator <= 0 || numerator / denominator > 1000) {
    throw new RangeError('Tasa racional de fotogramas no válida.');
  }
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

export function frameRateValue(input: FrameRateInput): number {
  const { numerator, denominator } = normalizeFrameRate(input);
  return numerator / denominator;
}

export function nominalFrameRate(input: FrameRateInput): number {
  return Math.max(1, Math.round(frameRateValue(input)));
}

/** The frame whose presentation interval contains time, allowing timestamp rounding. */
export function frameIndexAtTime(time: number, input: FrameRateInput): number {
  if (!Number.isFinite(time) || time < 0) throw new RangeError('Tiempo de fotograma no válido.');
  const rate = frameRateValue(input);
  // WebCodecs timestamps are integer microseconds. Rounding a CFR timestamp down
  // must not label the decoded frame as its predecessor (e.g. 0.033333 at 30 fps).
  return Math.floor(time * rate + rate / 1_000_000 + 1e-7);
}

export function frameTime(index: number, input: FrameRateInput): number {
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('Índice de fotograma no válido.');
  const { numerator, denominator } = normalizeFrameRate(input);
  return index * denominator / numerator;
}

/** Non-drop timecode: every frame is counted, including at fractional frame rates. */
export function formatFrameTimecode(index: number, input: FrameRateInput): string {
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('Índice de fotograma no válido.');
  const nominal = nominalFrameRate(input);
  const seconds = Math.floor(index / nominal);
  const fields = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60, index % nominal];
  return fields.map((value) => String(value).padStart(2, '0')).join(':');
}

export function formatTimecode(time: number, input: FrameRateInput): string {
  return formatFrameTimecode(frameIndexAtTime(time, input), input);
}

/** Parse HH:MM:SS:FF (non-drop) into seconds at the actual rational rate. */
export function parseTimecode(text: string, input: FrameRateInput): number | null {
  const match = /^(\d{2,}):(\d{2}):(\d{2}):(\d{2,})$/.exec(text.trim());
  if (!match) return null;
  const [hours, minutes, seconds, frames] = match.slice(1).map(Number);
  const nominal = nominalFrameRate(input);
  if (minutes >= 60 || seconds >= 60 || frames >= nominal) return null;
  const index = ((hours * 60 + minutes) * 60 + seconds) * nominal + frames;
  return Number.isSafeInteger(index) ? frameTime(index, input) : null;
}
