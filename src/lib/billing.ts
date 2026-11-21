import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * FitBite Pro billing layer.
 *
 * Production: install `@revenuecat/purchases-capacitor`, link `fitbite_pro_monthly` and
 * `fitbite_pro_yearly` in Play Console + RevenueCat, then set the env vars below. The code
 * talks to the plugin through Capacitor's registry, so no import changes are needed.
 * Local testing: with no RevenueCat key the layer runs in sandbox mode (no real charge).
 *
 *   NEXT_PUBLIC_REVENUECAT_ANDROID_KEY   RevenueCat public Android SDK key (goog_...)
 *   NEXT_PUBLIC_REVENUECAT_ENTITLEMENT   entitlement id, default "pro"
 *   NEXT_PUBLIC_PRO_MONTHLY_ID           default fitbite_pro_monthly
 *   NEXT_PUBLIC_PRO_YEARLY_ID            default fitbite_pro_yearly
 *   NEXT_PUBLIC_BILLING_SANDBOX          "1" forces sandbox even when a key is present
 */

export type ProPlan = 'monthly' | 'yearly';
export type BillingMode = 'sandbox' | 'store';

export const PRODUCT_IDS: Record<ProPlan, string> = {
  monthly: process.env.NEXT_PUBLIC_PRO_MONTHLY_ID || 'fitbite_pro_monthly',
  yearly: process.env.NEXT_PUBLIC_PRO_YEARLY_ID || 'fitbite_pro_yearly',
};

export const BILLING_CONFIG = {
  revenueCatAndroidKey: process.env.NEXT_PUBLIC_REVENUECAT_ANDROID_KEY || '',
  entitlement: process.env.NEXT_PUBLIC_REVENUECAT_ENTITLEMENT || 'pro',
  forceSandbox: process.env.NEXT_PUBLIC_BILLING_SANDBOX === '1',
  trialDays: 7,
  packageName: 'com.fitbitepro.app',
} as const;

export const SUBSCRIPTION_KEY = 'fitbite_user_subscription';
const PLAN_KEY = 'fitbite_play_plan_v1';

export type UserSubscription = {
  isPro: boolean;
  plan: ProPlan | null;
  trial?: boolean;
  startedAt?: string;
  renewsAt?: string | null;
  source?: BillingMode;
};

export type Offer = {
  plan: ProPlan;
  productId: string;
  /** Localized price without the period, for example "$29.99", "109 AED", "€29.99". */
  priceString: string;
  currency: string;
  trialDays: number;
  fromStore: boolean;
};

export type Offers = { monthly: Offer; yearly: Offer; mode: BillingMode };

export type BillingResult =
  | { ok: true; active: boolean; plan?: ProPlan; subscription?: UserSubscription }
  | { ok: false; reason: 'cancelled' | 'unavailable' | 'failed' };

// ---------------------------------------------------------------- RevenueCat plugin surface

type RcProduct = { identifier: string; priceString: string; price: number; currencyCode: string };
type RcPackage = { identifier: string; product: RcProduct };
type RcEntitlement = { productIdentifier: string; periodType?: string; expirationDate?: string | null; willRenew?: boolean; latestPurchaseDate?: string };
type RcCustomerInfo = { entitlements: { active: Record<string, RcEntitlement> } };
interface RcPlugin {
  configure(options: { apiKey: string }): Promise<void>;
  getOfferings(): Promise<{ current: { availablePackages: RcPackage[] } | null }>;
  purchasePackage(options: { aPackage: RcPackage }): Promise<{ customerInfo: RcCustomerInfo }>;
  restorePurchases(): Promise<{ customerInfo: RcCustomerInfo }>;
  getCustomerInfo(): Promise<{ customerInfo: RcCustomerInfo }>;
}

const Purchases = registerPlugin<RcPlugin>('Purchases');

export function billingMode(): BillingMode {
  if (BILLING_CONFIG.forceSandbox || !BILLING_CONFIG.revenueCatAndroidKey) return 'sandbox';
  return Capacitor.isNativePlatform() ? 'store' : 'sandbox';
}

let configured = false;
let cachedPackages: RcPackage[] = [];

async function configureStore() {
  if (configured) return;
  await Purchases.configure({ apiKey: BILLING_CONFIG.revenueCatAndroidKey });
  configured = true;
}

// ---------------------------------------------------------------- local subscription record

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
    if (raw?.isPro === true || plan) {
      return {
        isPro: true,
        plan,
        trial: raw?.trial === true,
        startedAt: typeof raw?.startedAt === 'string' ? raw.startedAt : undefined,
        renewsAt: typeof raw?.renewsAt === 'string' ? raw.renewsAt : null,
        source: raw?.source === 'store' ? 'store' : 'sandbox',
      };
    }
  } catch {
    /* A missing or damaged record stays on the free plan. */
  }
  return { isPro: false, plan: null };
}

export function writeUserSubscription(next: UserSubscription) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SUBSCRIPTION_KEY, JSON.stringify(next));
  if (next.isPro && next.plan) window.localStorage.setItem(PLAN_KEY, next.plan);
  else window.localStorage.removeItem(PLAN_KEY);
}

function fromEntitlement(entitlement: RcEntitlement | undefined): UserSubscription {
  if (!entitlement) return { isPro: false, plan: null };
  const plan: ProPlan = entitlement.productIdentifier.startsWith(PRODUCT_IDS.monthly) ? 'monthly' : 'yearly';
  return {
    isPro: true,
    plan,
    trial: entitlement.periodType === 'TRIAL' || entitlement.periodType === 'trial',
    startedAt: entitlement.latestPurchaseDate,
    renewsAt: entitlement.expirationDate ?? null,
    source: 'store',
  };
}

// ---------------------------------------------------------------- regional price list

type Region = 'US' | 'AE' | 'EU';

const EU_REGIONS = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);

const LOCAL_PRICES: Record<Region, { currency: string; monthly: string; yearly: string }> = {
  US: { currency: 'USD', monthly: '$6.99', yearly: '$29.99' },
  AE: { currency: 'AED', monthly: '25 AED', yearly: '109 AED' },
  EU: { currency: 'EUR', monthly: '€6.99', yearly: '€29.99' },
};

export function detectRegion(): Region {
  if (typeof navigator === 'undefined') return 'US';
  const locales = [...(navigator.languages ?? []), navigator.language].filter(Boolean);
  for (const locale of locales) {
    const region = locale.split('-')[1]?.toUpperCase();
    if (region === 'AE') return 'AE';
    if (region && EU_REGIONS.has(region)) return 'EU';
    if (region === 'US') return 'US';
  }
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (zone === 'Asia/Dubai') return 'AE';
    if (zone.startsWith('Europe/') && zone !== 'Europe/London') return 'EU';
  } catch {
    /* The USD list is the safe default. */
  }
  const language = (locales[0] || '').split('-')[0].toLowerCase();
  return language === 'de' || language === 'fr' || language === 'es' || language === 'it' ? 'EU' : 'US';
}

function localOffers(mode: BillingMode): Offers {
  const table = LOCAL_PRICES[detectRegion()];
  const make = (plan: ProPlan): Offer => ({
    plan,
    productId: PRODUCT_IDS[plan],
    priceString: table[plan],
    currency: table.currency,
    trialDays: plan === 'yearly' ? BILLING_CONFIG.trialDays : 0,
    fromStore: false,
  });
  return { monthly: make('monthly'), yearly: make('yearly'), mode };
}

/** Loads localized offers. Connected to Play Billing, the store's own currency and price win. */
export async function loadOffers(): Promise<Offers> {
  const mode = billingMode();
  const local = localOffers(mode);
  if (mode !== 'store') return local;
  try {
    await configureStore();
    const offerings = await Purchases.getOfferings();
    cachedPackages = offerings.current?.availablePackages ?? [];
    const merge = (plan: ProPlan): Offer => {
      const found = cachedPackages.find((pack) => pack.product.identifier.startsWith(PRODUCT_IDS[plan]));
      if (!found) return local[plan];
      return {
        plan,
        productId: found.product.identifier,
        priceString: found.product.priceString,
        currency: found.product.currencyCode,
        trialDays: plan === 'yearly' ? BILLING_CONFIG.trialDays : 0,
        fromStore: true,
      };
    };
    return { monthly: merge('monthly'), yearly: merge('yearly'), mode };
  } catch {
    return local;
  }
}

// ---------------------------------------------------------------- purchase, restore, status

export async function purchasePlan(plan: ProPlan): Promise<BillingResult> {
  if (typeof window === 'undefined') return { ok: false, reason: 'unavailable' };
  if (billingMode() === 'sandbox') {
    const now = new Date();
    const renews = new Date(now.getTime() + (plan === 'yearly' ? BILLING_CONFIG.trialDays : 30) * 86_400_000);
    const subscription: UserSubscription = { isPro: true, plan, trial: plan === 'yearly', startedAt: now.toISOString(), renewsAt: renews.toISOString(), source: 'sandbox' };
    writeUserSubscription(subscription);
    return { ok: true, active: true, plan, subscription };
  }
  try {
    await configureStore();
    if (cachedPackages.length === 0) await loadOffers();
    const target = cachedPackages.find((pack) => pack.product.identifier.startsWith(PRODUCT_IDS[plan]));
    if (!target) return { ok: false, reason: 'unavailable' };
    const { customerInfo } = await Purchases.purchasePackage({ aPackage: target });
    const subscription = fromEntitlement(customerInfo.entitlements.active[BILLING_CONFIG.entitlement]);
    if (!subscription.isPro) return { ok: false, reason: 'failed' };
    writeUserSubscription(subscription);
    return { ok: true, active: true, plan: subscription.plan ?? plan, subscription };
  } catch (error) {
    const cancelled = typeof error === 'object' && error !== null && (error as { userCancelled?: boolean }).userCancelled === true;
    return { ok: false, reason: cancelled ? 'cancelled' : 'failed' };
  }
}

export async function restorePurchases(): Promise<BillingResult> {
  if (typeof window === 'undefined') return { ok: false, reason: 'unavailable' };
  if (billingMode() === 'sandbox') {
    const saved = readUserSubscription();
    return saved.isPro ? { ok: true, active: true, plan: saved.plan ?? undefined, subscription: saved } : { ok: true, active: false };
  }
  try {
    await configureStore();
    const { customerInfo } = await Purchases.restorePurchases();
    const subscription = fromEntitlement(customerInfo.entitlements.active[BILLING_CONFIG.entitlement]);
    if (!subscription.isPro) return { ok: true, active: false };
    writeUserSubscription(subscription);
    return { ok: true, active: true, plan: subscription.plan ?? undefined, subscription };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Reconciles the saved plan with Google Play at launch. Sandbox plans are left untouched. */
export async function refreshSubscription(): Promise<UserSubscription | null> {
  if (billingMode() !== 'store') return null;
  try {
    await configureStore();
    const { customerInfo } = await Purchases.getCustomerInfo();
    const subscription = fromEntitlement(customerInfo.entitlements.active[BILLING_CONFIG.entitlement]);
    writeUserSubscription(subscription);
    return subscription;
  } catch {
    return null;
  }
}

/** Ends a sandbox plan so the free tier can be tested again. */
export function endSandboxSubscription() {
  writeUserSubscription({ isPro: false, plan: null });
}

export function manageSubscriptionUrl(plan: ProPlan | null) {
  const sku = plan ? `&sku=${encodeURIComponent(PRODUCT_IDS[plan])}` : '';
  return `https://play.google.com/store/account/subscriptions?package=${BILLING_CONFIG.packageName}${sku}`;
}
