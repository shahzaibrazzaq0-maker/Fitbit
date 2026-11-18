export const DEV_PRO_PREVIEW = false;

export type QuotaKind = 'scan' | 'coach' | 'kitchen' | 'challenge';

const QUOTA_KEY = 'fitbite_daily_quota_v1';

const FREE_LIMITS: Record<QuotaKind, number> = {
  scan: 3,
  coach: 5,
  kitchen: 3,
  challenge: 1,
};

const PRO_LIMITS: Record<QuotaKind, number> = {
  scan: 50,
  coach: 100,
  kitchen: 30,
  challenge: 8,
};

type Ledger = Record<QuotaKind, number> & { date: string };

function todayKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function emptyLedger(date: string): Ledger {
  return { date, scan: 0, coach: 0, kitchen: 0, challenge: 0 };
}

function readLedger(): Ledger {
  const today = todayKey();
  if (typeof window === 'undefined') return emptyLedger(today);
  try {
    const raw = JSON.parse(window.localStorage.getItem(QUOTA_KEY) || 'null') as Partial<Ledger> | null;
    if (!raw || raw.date !== today) return emptyLedger(today);
    const used = (kind: QuotaKind) => (typeof raw[kind] === 'number' && raw[kind] > 0 ? Math.floor(raw[kind]) : 0);
    return { date: today, scan: used('scan'), coach: used('coach'), kitchen: used('kitchen'), challenge: used('challenge') };
  } catch {
    return emptyLedger(today);
  }
}

function writeLedger(ledger: Ledger) {
  window.localStorage.setItem(QUOTA_KEY, JSON.stringify(ledger));
}

export function isProPlan(storedPro: boolean) {
  return DEV_PRO_PREVIEW || storedPro;
}

export function quotaLimit(kind: QuotaKind, pro: boolean) {
  return (pro ? PRO_LIMITS : FREE_LIMITS)[kind];
}

export function quotaLeft(kind: QuotaKind, pro: boolean) {
  const limit = quotaLimit(kind, pro);
  const used = Math.min(limit, readLedger()[kind]);
  return { used, limit, left: Math.max(0, limit - used) };
}

export function canSpend(kind: QuotaKind, pro: boolean) {
  if (pro || kind === 'coach') return true;
  return quotaLeft(kind, pro).left > 0;
}

export function spendQuota(kind: QuotaKind, pro: boolean) {
  if (pro || kind === 'coach') return true;
  if (!canSpend(kind, pro)) return false;
  const ledger = readLedger();
  ledger[kind] += 1;
  writeLedger(ledger);
  return true;
}

export const QUOTA_STORAGE_KEY = QUOTA_KEY;
