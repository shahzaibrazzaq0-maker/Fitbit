export type ProPlan = 'monthly' | 'yearly';

export type BillingResult =
  | { ok: true; active: boolean; plan?: ProPlan }
  | { ok: false; reason: string };

const PLAN_KEY = 'fitbite_play_plan_v1';

function readPlan(): ProPlan | null {
  if (typeof window === 'undefined') return null;
  const saved = window.localStorage.getItem(PLAN_KEY);
  return saved === 'monthly' || saved === 'yearly' ? saved : null;
}

export async function subscribeFitBitePro(plan: ProPlan): Promise<BillingResult> {
  if (typeof window === 'undefined') return { ok: false, reason: 'unavailable' };
  window.localStorage.setItem(PLAN_KEY, plan);
  return { ok: true, active: true, plan };
}

export async function restoreFitBitePro(): Promise<BillingResult> {
  const plan = readPlan();
  if (!plan) return { ok: true, active: false };
  return { ok: true, active: true, plan };
}
