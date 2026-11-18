export type ProAccess = {
  status: 'early-access';
  billing: 'not-configured';
};

/**
 * Play Billing stub. Digital upgrades must go through Google Play, not a card form.
 * When the product IDs exist, install `@revenuecat/purchases-capacitor` and replace
 * this body with Purchases.configure + Purchases.getCustomerInfo. Do not invent a purchase.
 */
export async function readProAccess(): Promise<ProAccess> {
  return { status: 'early-access', billing: 'not-configured' };
}
