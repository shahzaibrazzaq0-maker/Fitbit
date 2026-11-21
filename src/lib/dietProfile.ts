export const DIET_KEY = 'fitbite_diet_v1';
export const AI_CONSENT_KEY = 'fitbite_ai_consent_v1';

export type DietPrefs = {
  halal: boolean;
  vegan: boolean;
  vegetarian: boolean;
  glutenFree: boolean;
  lactoseFree: boolean;
  nutFree: boolean;
  desiFit: boolean;
};

export const DIET_FLAGS = ['halal', 'vegan', 'vegetarian', 'glutenFree', 'desiFit', 'lactoseFree', 'nutFree'] as const;

export function emptyDiet(): DietPrefs {
  return { halal: false, vegan: false, vegetarian: false, glutenFree: false, lactoseFree: false, nutFree: false, desiFit: false };
}

export function readDiet(): DietPrefs {
  if (typeof window === 'undefined') return emptyDiet();
  try {
    const raw = JSON.parse(window.localStorage.getItem(DIET_KEY) || 'null') as Partial<DietPrefs> | null;
    const base = emptyDiet();
    if (!raw) return base;
    (Object.keys(base) as (keyof DietPrefs)[]).forEach((key) => {
      if (typeof raw[key] === 'boolean') base[key] = raw[key];
    });
    return base;
  } catch {
    return emptyDiet();
  }
}

export function writeDiet(prefs: DietPrefs) {
  window.localStorage.setItem(DIET_KEY, JSON.stringify(prefs));
}

export function readAiConsent() {
  if (typeof window === 'undefined') return true;
  const raw = window.localStorage.getItem(AI_CONSENT_KEY);
  if (raw === null) return true;
  return raw === '1';
}

export function writeAiConsent(on: boolean) {
  window.localStorage.setItem(AI_CONSENT_KEY, on ? '1' : '0');
}

export function dietRuleLine(prefs: DietPrefs) {
  const rules = [
    prefs.halal ? 'halal' : '',
    prefs.vegan ? 'vegan' : '',
    prefs.vegetarian ? 'vegetarian' : '',
    prefs.glutenFree ? 'gluten-free' : '',
    prefs.lactoseFree ? 'lactose-free' : '',
    prefs.nutFree ? 'nut-free' : '',
  ].filter(Boolean);
  const lines: string[] = [];
  if (rules.length) lines.push(`Dietary rules: ${rules.join(', ')}. Do not suggest foods that conflict.`);
  if (prefs.halal) lines.push('Halal is strict: no pork, alcohol, gelatin, or non-halal meat in any answer, recipe, or scan verdict. Say when halal status cannot be confirmed.');
  if (prefs.desiFit) lines.push('Desi Fit: prefer South Asian home-style food (roti, daal, sabzi, grilled tikka, raita) with lean, portion-aware, high-protein versions.');
  return lines.join(' ');
}

export type DietCode = 'match' | 'halal' | 'notHalal' | 'gluten' | 'milk' | 'nuts' | 'notVegan' | 'notVegetarian' | 'halalUnknown';

const HARAM = /\b(pork|bacon|ham|lard|wine|beer|alcohol|rum|whisky|gelatin)\b/i;

function hasTag(tags: string[], names: string[]) {
  return tags.some((tag) => names.some((name) => tag === name || tag.endsWith(`:${name}`)));
}

export function judgeDiet(prefs: DietPrefs, input: { name: string; allergens?: string[]; analysis?: string[]; halal?: boolean | null; contains?: string[] }): DietCode[] {
  const tags = [...(input.allergens ?? []), ...(input.analysis ?? []), ...(input.contains ?? [])].map((tag) => tag.toLowerCase());
  const name = input.name.toLowerCase();
  const conflicts: DietCode[] = [];
  const gluten = hasTag(tags, ['gluten', 'wheat']) || /\b(gluten|wheat)\b/.test(name);
  const milk = hasTag(tags, ['milk', 'lactose']) || /\b(milk|lactose|cheese|cream)\b/.test(name);
  const nuts = hasTag(tags, ['nuts', 'peanuts', 'nuts-traces']) || /\b(almond|peanut|cashew|walnut|hazelnut|pistachio)\b/.test(name);
  const haram = hasTag(tags, ['pork', 'alcohol']) || HARAM.test(name);
  const nonVegan = hasTag(tags, ['non-vegan']) || haram || milk || /\b(egg|honey|meat|chicken|fish)\b/.test(name);
  const vegan = hasTag(tags, ['vegan']) && !nonVegan;
  const nonVegetarian = hasTag(tags, ['non-vegetarian']) || haram || /\b(meat|chicken|fish|gelatin)\b/.test(name);
  const vegetarian = hasTag(tags, ['vegetarian', 'vegan']) && !nonVegetarian;
  if (prefs.glutenFree && gluten) conflicts.push('gluten');
  if (prefs.lactoseFree && milk) conflicts.push('milk');
  if (prefs.nutFree && nuts) conflicts.push('nuts');
  if (prefs.vegan && nonVegan && !vegan) conflicts.push('notVegan');
  if (prefs.vegetarian && nonVegetarian && !vegetarian) conflicts.push('notVegetarian');
  if (prefs.halal && (haram || input.halal === false)) conflicts.push('notHalal');
  if (conflicts.length) return conflicts;
  const ok: DietCode[] = [];
  const other = prefs.vegan || prefs.vegetarian || prefs.glutenFree || prefs.lactoseFree || prefs.nutFree;
  if (other) ok.push('match');
  if (prefs.halal && (input.halal === true || hasTag(tags, ['halal'])) && !haram) ok.push('halal');
  else if (prefs.halal) ok.push('halalUnknown');
  if (!other && ok.includes('halal')) ok.unshift('match');
  return ok;
}
