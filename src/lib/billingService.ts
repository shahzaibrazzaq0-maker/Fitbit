export type BillingResult =
  | { ok: true; active: boolean }
  | { ok: false; reason: string };

/**
 * Google Play Billing is not connected in this build.
 * Restore completes without throwing and does not grant Pro.
 * When the product exists, install `@revenuecat/purchases-capacitor` and
 * replace this body with Purchases.restorePurchases. Do not add a card form.
 */
export async function restoreFitBitePro(): Promise<BillingResult> {
  return { ok: true, active: false };
}
