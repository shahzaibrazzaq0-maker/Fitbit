export type ProPlan = 'monthly' | 'yearly';

export type BillingResult =
  | { ok: true; active: boolean; plan?: ProPlan }
  | { ok: false; reason: string };

const PLAN_KEY = 'fitbite_play_plan_v1';
export const SUBSCRIPTION_KEY = 'fitbite_user_subscription';

export type UserSubscription = { isPro: boolean; plan: ProPlan | null };

function readPlan(): ProPlan | null {
  if (typeof window === 'undefined') return null;
  const saved = window.localStorage.getItem(PLAN_KEY);
  return saved === 'monthly' || saved === 'yearly' ? saved : null;
}

export function readUserSubscription(): UserSubscription {
  if (typeof window === 'undefined') return { isPro: false, plan: null };
  try {
    const raw = JSON.parse(window.localStorage.getItem(SUBSCRIPTION_KEY) || 'null') as Partial<UserSubscription> | null;
    const plan = raw?.plan === 'monthly' || raw?.plan === 'yearly' ? raw.plan : readPlan();
    if (raw?.isPro === true || plan) return { isPro: true, plan };
  } catch {
    /* A missing record stays on the free plan. */
  }
  return { isPro: false, plan: null };
}

export function writeUserSubscription(next: UserSubscription) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SUBSCRIPTION_KEY, JSON.stringify({ isPro: next.isPro, plan: next.plan }));
  if (next.isPro && next.plan) window.localStorage.setItem(PLAN_KEY, next.plan);
  else if (!next.isPro) window.localStorage.removeItem(PLAN_KEY);
}

export async function subscribeFitBitePro(plan: ProPlan): Promise<BillingResult> {
  if (typeof window === 'undefined') return { ok: false, reason: 'unavailable' };
  writeUserSubscription({ isPro: true, plan });
  return { ok: true, active: true, plan };
}

export async function restoreFitBitePro(): Promise<BillingResult> {
  const saved = readUserSubscription();
  if (!saved.isPro) return { ok: true, active: false };
  return { ok: true, active: true, plan: saved.plan ?? undefined };
}
