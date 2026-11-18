const AI_CACHE_KEY = 'fitbite_ai_cache_v1';

let route = 'Auto-Fusion';

export function engineRoute() {
  return route;
}

export function lastAiWasBillable() {
  return route !== 'Cache' && route !== 'On-device' && route !== 'Unavailable' && route !== 'Auto-Fusion';
}

export function noteLocalFallback() {
  if (route !== 'Cache') route = 'On-device';
}

function scrub(value: string) {
  return value.replace(/sk-or-[a-z0-9_-]+/gi, '').replace(/AQ\.[A-Za-z0-9_-]+/g, '');
}

function hashString(value: string) {
  let h = 2166136261;
  const end = Math.min(value.length, 12000);
  for (let i = 0; i < end; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= value.length;
  return h >>> 0;
}

function readAiCache(key: string) {
  if (typeof window === 'undefined') return '';
  try {
    const rows = JSON.parse(window.localStorage.getItem(AI_CACHE_KEY) || '[]') as { k: string; v: string }[];
    return rows.find((row) => row.k === key)?.v ?? '';
  } catch {
    return '';
  }
}

function writeAiCache(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    const rows = JSON.parse(window.localStorage.getItem(AI_CACHE_KEY) || '[]') as { k: string; v: string }[];
    const next = [{ k: key, v: value.slice(0, 2000) }, ...rows.filter((row) => row.k !== key)].slice(0, 40);
    window.localStorage.setItem(AI_CACHE_KEY, JSON.stringify(next));
  } catch {
    /* Cache misses stay on the network path. */
  }
}

export function foodIsHalal(name: string) {
  const n = name.toLowerCase();
  if (/(pork|bacon|ham|wine|beer|alcohol|rum|whisky|gelatin)/.test(n)) return false;
  return /(oat|lentil|daal|salad|fruit|banana|apple|yogurt|egg|tea|nut|rice|water|vegetable|veggie|berry|milk)/.test(n);
}

const HARAM_NAME = /(pork|bacon|ham|wine|beer|alcohol|rum|whisky)/;

export function parseJsonRecord(raw: string) {
  const stripped = scrub(raw).replace(/^\uFEFF/, '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('json missing');
  const slice = stripped.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');
  const data = JSON.parse(slice) as unknown;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('json shape');
  return data as Record<string, unknown>;
}

function finiteNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value === 'string') {
    const n = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

function scanNumber(value: unknown) {
  const n = finiteNumber(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

export interface ScanCard {
  name: string;
  servingG: number;
  score: number | null;
  calories: number;
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
  calcium: number;
  iron: number;
  sugar: number;
  sodium: number;
  vitamins: string[];
  halal: boolean;
  verdict: string;
  model: string;
  contains: string[];
}

export function parseScanNutrition(raw: string): ScanCard {
  const data = parseJsonRecord(raw);
  const name = typeof data.name === 'string' ? data.name.trim().slice(0, 80) : '';
  const calories = finiteNumber(data.calories);
  if (!name || !Number.isFinite(calories)) throw new Error('nutrition json incomplete');
  const vitamins = Array.isArray(data.vitamins)
    ? data.vitamins.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim().slice(0, 40)).slice(0, 4)
    : [];
  const score = finiteNumber(data.score);
  return {
    name,
    servingG: scanNumber(data.servingG),
    score: Number.isFinite(score) ? Math.min(10, Math.max(1, Math.round(score))) : null,
    calories: Math.max(0, Math.round(calories)),
    carbs: scanNumber(data.carbs),
    protein: scanNumber(data.protein),
    fat: scanNumber(data.fat),
    fiber: scanNumber(data.fiber),
    calcium: scanNumber(data.calcium),
    iron: scanNumber(data.iron),
    sugar: scanNumber(data.sugar),
    sodium: scanNumber(data.sodium),
    vitamins,
    halal: data.halal === true && !HARAM_NAME.test(name.toLowerCase()),
    verdict: typeof data.verdict === 'string' ? scrub(data.verdict).trim().slice(0, 140) : '',
    model: '',
    contains: Array.isArray(data.contains)
      ? data.contains.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim().slice(0, 40)).slice(0, 8)
      : [],
  };
}

export interface RecipeCard {
  title: string;
  cal: number;
  protein: number;
  carbs: number;
  fats: number;
  steps: string[];
  halal?: boolean;
}

export function recipeFromGemini(raw: string): RecipeCard {
  const data = parseJsonRecord(raw);
  const title = typeof data.title === 'string' ? data.title.trim().slice(0, 80) : '';
  const steps = Array.isArray(data.steps)
    ? data.steps.filter((step): step is string => typeof step === 'string' && step.trim().length > 0).map((step) => step.trim().slice(0, 90)).slice(0, 4)
    : [];
  const calories = finiteNumber(data.calories);
  const protein = finiteNumber(data.protein);
  const carbs = finiteNumber(data.carbs);
  const fats = finiteNumber(data.fats);
  if (!title || steps.length < 1 || !Number.isFinite(calories)) throw new Error('recipe json incomplete');
  return {
    title,
    cal: Math.round(calories),
    protein: Number.isFinite(protein) ? Math.max(0, Math.round(protein)) : 0,
    carbs: Number.isFinite(carbs) ? Math.max(0, Math.round(carbs)) : 0,
    fats: Number.isFinite(fats) ? Math.max(0, Math.round(fats)) : 0,
    steps,
    halal: data.halal === true && !HARAM_NAME.test(title.toLowerCase()),
  };
}

const LIVE_AI_ORIGIN = 'https://fitbite-pro.vercel.app';

function nativeApp() {
  if (typeof window === 'undefined') return false;
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

function aiEndpoint() {
  if (nativeApp()) return `${LIVE_AI_ORIGIN}/api/ai`;
  if (typeof window !== 'undefined') {
    const { hostname, port } = window.location;
    const devPort = port !== '' && port !== '80' && port !== '443';
    if ((hostname === 'localhost' || hostname === '127.0.0.1') && devPort) return '/api/ai';
  }
  const configured = (process.env.NEXT_PUBLIC_AI_PROXY_URL || LIVE_AI_ORIGIN).replace(/\/$/, '');
  return `${configured}/api/ai`;
}

function retryableAiError(message: string) {
  return /429|503|timeout|busy|high demand|rate limit|network|fetch/i.test(message);
}

async function postAi(body: Record<string, unknown>, timeoutMs = 45000) {
  let last = 'network';
  const attempts = timeoutMs <= 8000 ? 1 : 2;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(aiEndpoint(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw = await response.text();
      if (!response.ok) {
        last = response.status === 429 || response.status === 503 ? `HTTP ${response.status}` : 'proxy';
        if (attempt === 0 && (response.status === 429 || response.status === 503 || response.status >= 500)) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          continue;
        }
        throw new Error(last);
      }
      return JSON.parse(raw) as { text?: string; route?: string; card?: ScanCard; error?: string };
    } catch (error) {
      last = error instanceof Error ? error.message : 'network';
      if (attempt === 0 && retryableAiError(last)) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        continue;
      }
      throw error instanceof Error ? error : new Error(last);
    }
  }
  throw new Error(last);
}

export async function analyzeFoodPhoto(prompt: string, jpeg: string) {
  if (!jpeg || jpeg.length < 32) return { error: 'The photo was empty. Take another one.' };
  try {
    const data = await postAi({ op: 'vision', prompt, jpeg });
    if (data.card?.name) {
      route = data.card.model || 'Gemini 3.5 Flash Lite';
      return { card: data.card };
    }
    const message = data.error || 'The scan did not return nutrition.';
    return { error: message.slice(0, 180) };
  } catch {
    return { error: 'The scan didn’t reach the server. Tap the photo again to retry.' };
  }
}

export async function transcribeSpeech(audioBase64: string, mimeType: string) {
  if (audioBase64.trim().length < 32) return '';
  try {
    const data = await postAi({ op: 'transcribe', audio: audioBase64, mime: mimeType });
    return typeof data.text === 'string' ? data.text.slice(0, 400) : '';
  } catch {
    return '';
  }
}

export async function askNeural(prompt: string, jpeg: string | undefined, tokens: number, temperature: number, timeoutMs = 45000) {
  const cacheId = hashString(`${prompt}|${jpeg?.length ?? 0}|${jpeg?.slice(0, 48) ?? ''}`).toString(16);
  const cached = readAiCache(cacheId);
  if (cached) {
    route = 'Cache';
    return cached;
  }
  try {
    const data = await postAi({ op: 'ask', prompt, jpeg, tokens, temperature }, timeoutMs);
    if (data.text) {
      route = data.route || 'Gemini';
      writeAiCache(cacheId, data.text);
      return data.text;
    }
  } catch {
    /* The on-device coach and kitchen still answer. */
  }
  route = 'On-device';
  return '';
}

export interface WellnessChallenge {
  title: string;
  tip: string;
  category: string;
}

const SAFE_HABITS: readonly WellnessChallenge[] = [
  { title: 'Drink one glass of water', tip: 'Start with water before your next meal.', category: 'Hydration' },
  { title: 'Take a ten-minute walk', tip: 'A short easy walk counts as movement today.', category: 'Movement' },
  { title: 'Stretch your neck and shoulders', tip: 'Roll your shoulders, then relax your jaw.', category: 'Stretch' },
  { title: 'Add vegetables to one meal', tip: 'Put greens or salad beside what you already eat.', category: 'Nutrition' },
  { title: 'Eat one mindful bite', tip: 'Put the phone down for the first few bites.', category: 'Mindful' },
  { title: 'Refill your water bottle', tip: 'Keep water where you can see it this afternoon.', category: 'Hydration' },
  { title: 'Walk after your next meal', tip: 'Ten easy minutes outside, or around your home.', category: 'Movement' },
  { title: 'Open your chest and breathe', tip: 'Clasp hands behind you and lift gently.', category: 'Stretch' },
  { title: 'Add a protein side', tip: 'Eggs, yogurt, lentils, or chicken with your plate.', category: 'Nutrition' },
  { title: 'Pause before a snack', tip: 'Notice if you are hungry, bored, or just tired.', category: 'Mindful' },
  { title: 'Drink water with lunch', tip: 'One glass at the table, then eat as usual.', category: 'Hydration' },
  { title: 'Take the long way once', tip: 'Add a calm ten-minute loop to an errand.', category: 'Movement' },
  { title: 'Stretch your hips lightly', tip: 'A gentle lunge or figure-four, no forcing.', category: 'Stretch' },
  { title: 'Fill half the plate with plants', tip: 'Vegetables or fruit next to your usual meal.', category: 'Nutrition' },
];

const UNSAFE_CHALLENGE = /\b(fast|fasting|supplement|pill|dose|diagnos|medication|medicine|hiit|sprint|burpee|starve|detox|cleanse|extreme|injection|drug)\b/i;

function clipWords(value: string, max: number) {
  return value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, max).join(' ');
}

export function localWellnessChallenge(seed: number): WellnessChallenge {
  const index = ((seed % SAFE_HABITS.length) + SAFE_HABITS.length) % SAFE_HABITS.length;
  return SAFE_HABITS[index];
}

function challengeFromModel(raw: string, seed: number): WellnessChallenge {
  const fallback = localWellnessChallenge(seed);
  try {
    const data = parseJsonRecord(raw);
    const title = clipWords(typeof data.title === 'string' ? data.title : '', 6);
    const tip = clipWords(typeof data.tip === 'string' ? data.tip : '', 14);
    const category = clipWords(typeof data.category === 'string' ? data.category : 'Wellness', 2);
    if (!title || !tip || UNSAFE_CHALLENGE.test(`${title} ${tip} ${category}`)) return fallback;
    return { title, tip, category: category || 'Wellness' };
  } catch {
    return fallback;
  }
}

export function preferencePrompt(languageName: string, dietLine: string) {
  return [`Reply in ${languageName}.`, dietLine].filter(Boolean).join('\n');
}

export async function suggestDailyChallenge(input: { waterL: number; meals: number; workouts: number; seed: number; language?: string; diet?: string }): Promise<WellnessChallenge> {
  const fallback = localWellnessChallenge(input.seed);
  const prompt = [
    'Return ONLY JSON: {"title":"","tip":"","category":""}.',
    'title is at most 6 words. tip is at most 14 words.',
    'ONLY a safe, gentle, everyday wellness habit: hydration, a 10-minute walk, light stretching, mindful eating, or adding protein or vegetables.',
    'NEVER suggest extreme fasting, medical treatments, supplements, or strenuous unverified exercises.',
    input.language ? `Write title and tip in ${input.language}.` : '',
    input.diet || '',
    `Context: water ${input.waterL.toFixed(1)} L, meals logged ${input.meals}, workouts saved ${input.workouts}. Variation ${input.seed}.`,
  ].filter(Boolean).join(' ');
  try {
    const text = await askNeural(prompt, undefined, 120, 0.4);
    if (!text) return fallback;
    return challengeFromModel(text, input.seed);
  } catch {
    return fallback;
  }
}

