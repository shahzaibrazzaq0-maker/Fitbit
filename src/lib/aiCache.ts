/** Small localStorage cache with a 24-hour life for Kitchen recipes and quick-chip coach answers. */
export const AI_TTL_KEY = 'fitbite_ai_ttl_v1';
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ROWS = 60;

type Row = { k: string; v: string; t: number };

function readRows(): Row[] {
  if (typeof window === 'undefined') return [];
  try {
    const rows = JSON.parse(window.localStorage.getItem(AI_TTL_KEY) || '[]') as Row[];
    const now = Date.now();
    return Array.isArray(rows) ? rows.filter((row) => row && typeof row.k === 'string' && typeof row.v === 'string' && now - row.t < TTL_MS) : [];
  } catch {
    return [];
  }
}

export function readTtl(key: string) {
  return readRows().find((row) => row.k === key)?.v ?? '';
}

export function writeTtl(key: string, value: string) {
  if (typeof window === 'undefined' || !value) return;
  try {
    const rows = [{ k: key, v: value.slice(0, 3000), t: Date.now() }, ...readRows().filter((row) => row.k !== key)].slice(0, MAX_ROWS);
    window.localStorage.setItem(AI_TTL_KEY, JSON.stringify(rows));
  } catch {
    /* A missed write only means the next tap asks the network. */
  }
}

/** One stable key from the parts that change an answer: ingredients, language, diet filters, units. */
export function ttlKey(scope: string, parts: (string | number)[]) {
  return `${scope}|${parts.map((part) => String(part).toLowerCase().replace(/\s+/g, ' ').trim()).join('|')}`;
}
