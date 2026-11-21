export const OFF_CACHE_KEY = 'fitbite_off_cache_v1';

export interface NutrientBlock {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  sugar: number;
  salt: number;
  sodiumMg: number;
  fiber: number;
}

export interface OffProduct {
  barcode: string;
  name: string;
  brand: string;
  image: string;
  serving: string;
  per100: NutrientBlock;
  perServing: NutrientBlock | null;
  nutriscore: 'a' | 'b' | 'c' | 'd' | 'e' | null;
  nova: 1 | 2 | 3 | 4 | null;
  allergens: string[];
  analysis: string[];
}

type OffJson = {
  status?: number;
  product?: {
    product_name?: string;
    brands?: string;
    serving_size?: string;
    image_front_small_url?: string;
    nutriscore_grade?: string;
    nova_group?: number;
    allergens_tags?: string[];
    ingredients_analysis_tags?: string[];
    nutriments?: Record<string, unknown>;
  };
};

function num(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function block(n: Record<string, unknown>, suffix: '100g' | 'serving'): NutrientBlock {
  const sodium = num(n[`sodium_${suffix}`]);
  return {
    calories: Math.round(num(n[`energy-kcal_${suffix}`])),
    protein: Math.round(num(n[`proteins_${suffix}`]) * 10) / 10,
    carbs: Math.round(num(n[`carbohydrates_${suffix}`]) * 10) / 10,
    fat: Math.round(num(n[`fat_${suffix}`]) * 10) / 10,
    sugar: Math.round(num(n[`sugars_${suffix}`]) * 10) / 10,
    salt: Math.round(num(n[`salt_${suffix}`]) * 100) / 100,
    sodiumMg: Math.round(sodium * 1000),
    fiber: Math.round(num(n[`fiber_${suffix}`]) * 10) / 10,
  };
}

function hasServing(blockValue: NutrientBlock) {
  return blockValue.calories > 0 || blockValue.protein > 0 || blockValue.carbs > 0 || blockValue.fat > 0;
}

function readCache(barcode: string) {
  if (typeof window === 'undefined') return null;
  try {
    const rows = JSON.parse(window.localStorage.getItem(OFF_CACHE_KEY) || '[]') as OffProduct[];
    return rows.find((row) => row.barcode === barcode) ?? null;
  } catch {
    return null;
  }
}

function writeCache(product: OffProduct) {
  try {
    const rows = JSON.parse(window.localStorage.getItem(OFF_CACHE_KEY) || '[]') as OffProduct[];
    const next = [product, ...rows.filter((row) => row.barcode !== product.barcode)].slice(0, 40);
    window.localStorage.setItem(OFF_CACHE_KEY, JSON.stringify(next));
  } catch {
    /* A missed cache still shows the live product. */
  }
}

export function mapOffProduct(barcode: string, data: OffJson): OffProduct | null {
  if (data.status !== 1 || !data.product) return null;
  const product = data.product;
  const nutriments = product.nutriments ?? {};
  const grade = (product.nutriscore_grade || '').toLowerCase();
  const nova = product.nova_group;
  const serving = block(nutriments, 'serving');
  return {
    barcode,
    name: (product.product_name || 'Unnamed product').trim().slice(0, 80),
    brand: (product.brands || '').split(',')[0]?.trim().slice(0, 40) || '',
    image: product.image_front_small_url || '',
    serving: (product.serving_size || '').slice(0, 40),
    per100: block(nutriments, '100g'),
    perServing: hasServing(serving) ? serving : null,
    nutriscore: grade === 'a' || grade === 'b' || grade === 'c' || grade === 'd' || grade === 'e' ? grade : null,
    nova: nova === 1 || nova === 2 || nova === 3 || nova === 4 ? nova : null,
    allergens: Array.isArray(product.allergens_tags) ? product.allergens_tags.map((tag) => tag.toLowerCase()) : [],
    analysis: Array.isArray(product.ingredients_analysis_tags) ? product.ingredients_analysis_tags.map((tag) => tag.toLowerCase()) : [],
  };
}

/** Barcode first: a hit is instant and free. Returns null when the product is unknown, so the caller can ask the AI. */
export async function lookupOpenFoodFacts(barcode: string, signal?: AbortSignal): Promise<OffProduct | null> {
  const code = barcode.replace(/\D/g, '');
  if (code.length < 6) return null;
  const cached = readCache(code);
  if (cached) return cached;
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  if (signal?.aborted) ctrl.abort();
  else signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, 5000);
  try {
    const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,nutriments,nutriscore_grade,nova_group,allergens_tags,ingredients_analysis_tags,serving_size,image_front_small_url`, { signal: ctrl.signal });
    if (!response.ok) return null;
    const product = mapOffProduct(code, (await response.json()) as OffJson);
    if (product) writeCache(product);
    return product;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}
