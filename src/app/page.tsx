'use client';

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { APP_LEGAL_URLS } from '../../capacitor.config';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BarcodeScanModal } from '@/components/BarcodeScanModal';
import { AI_TTL_KEY, readTtl, ttlKey } from '@/lib/aiCache';
import { analyzeFoodPhoto, askNeural, engineRoute as readEngineRoute, lastAiWasBillable, localWellnessChallenge, parseJsonRecord, parseScanNutrition, preferencePrompt, recipeFromStream, streamNeural, suggestDailyChallenge, transcribeSpeech, warmAiServer, type WellnessChallenge } from '@/lib/aiEngine';
import { AI_CONSENT_KEY, DIET_KEY, DIET_FLAGS, dietRuleLine, emptyDiet, judgeDiet, readAiConsent, readDiet, writeAiConsent, writeDiet, type DietCode, type DietPrefs } from '@/lib/dietProfile';
import { LANG_KEY, LANGS, aiLanguageName, applyDocumentLanguage, languageName, readLang, translate, writeLang, type CopyKey, type Lang } from '@/lib/i18n';
import { lookupOpenFoodFacts, OFF_CACHE_KEY, type OffProduct } from '@/lib/openFoodFacts';
import { refreshSubscription, readUserSubscription, SUBSCRIPTION_KEY, writeUserSubscription } from '@/lib/billing';
import { ProPaywall, type PaywallReason } from '@/components/ProPaywall';
import { LegalModal, type LegalKind } from '@/components/LegalModal';
import { UNITS_KEY, formatHeightUnits, formatLiftWeight, formatWater, formatWaterGoal, formatWeight, inToCm, kgToLb, lbToKg, readUnits, round as roundTo, waterGoalL, waterStepL, waterStepLabel, weightUnit, writeUnits, type UnitSystem } from '@/lib/units';
import { QUOTA_STORAGE_KEY, canSpend, isProPlan, quotaLeft, spendQuota, type QuotaKind } from '@/lib/usageLimits';

type FlowStep = 'welcome' | 'auth' | 'profile' | 'device' | 'app';
type Tab = 'today' | 'health' | 'ai' | 'sport' | 'me';
type AiTab = 'coach' | 'kitchen' | 'scan';
type ScanMode = 'photo' | 'barcode';
type AuthProvider = 'google' | 'apple' | 'huawei';
type WatchId = 'apple' | 'samsung' | 'huawei';
type HeightUnit = 'cm' | 'ft';
type TrainingGoal = 'muscle' | 'fat';
type LiftName = 'Bench Press' | 'Squat' | 'Deadlift';
type MuscleGroup = 'Chest' | 'Back' | 'Legs' | 'Shoulders' | 'Arms';
type SessionFocus = 'Push' | 'Pull' | 'Legs';

interface MealItem {
  id: number;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  time: string;
}

function nutritionFromMeals(meals: MealItem[]) {
  return meals.reduce(
    (sum, meal) => ({
      calories: sum.calories + meal.calories,
      protein: sum.protein + meal.protein,
      carbs: sum.carbs + meal.carbs,
      fats: sum.fats + meal.fats,
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0 },
  );
}

interface AiScanResult {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  score: number;
  advice: string;
}

interface ScanNutrition {
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
  contains?: string[];
}

interface Ingredient {
  id: number;
  name: string;
}

interface ChatMessage {
  id: number;
  sender: 'user' | 'ai';
  text: string;
}

const COACH_WELCOME = 'Ask me about training, food, or your next meal in any language.';

function coachWelcome(): ChatMessage[] {
  return [{ id: 1, sender: 'ai', text: COACH_WELCOME }];
}

interface WorkoutLog {
  id: number;
  sport: string;
  seconds: number;
  distanceKm: number;
  calories: number;
  savedAt: string;
  focus?: SessionFocus;
}

interface WristAlert {
  id: number;
  device: string;
  text: string;
  at: string;
}

interface CustomWatch {
  id: string;
  name: string;
  brand: string;
  battery: number;
  mac?: string;
}

type BleDevice = { mac: string; name: string; rssi: number | null; bonded: boolean; hr: boolean; bleType: string };
type BleLinkState = 'connecting' | 'connected' | 'live' | 'noHr' | 'classic' | 'disconnected';
type BleLink = { mac: string; state: BleLinkState; reason?: string };
type BleEvent =
  | { type: 'status'; state: string }
  | { type: 'device'; mac: string; name: string; rssi: number | null; bonded: boolean; hr: boolean; bleType: string }
  | { type: 'connection'; state: BleLinkState; mac: string; name: string; reason?: string }
  | { type: 'hr'; bpm: number; rr?: number[]; contact?: boolean }
  | { type: 'battery'; level: number };
type NativeBle = {
  startScan?: () => void;
  stopScan?: () => void;
  connectWatch?: (mac: string, name: string) => void;
  disconnectWatch?: () => void;
  openBluetoothSettings?: () => void;
  openLocationSettings?: () => void;
  openAppSettings?: () => void;
};

const LAST_WATCH_KEY = 'fitbite_last_watch_v1';

function nativeBle(): NativeBle | undefined {
  if (typeof window === 'undefined') return undefined;
  const bridge = (window as Window & { FitBiteNative?: NativeBle }).FitBiteNative;
  return bridge?.startScan ? bridge : undefined;
}

function readLastWatch(): { mac: string; name: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = JSON.parse(window.localStorage.getItem(LAST_WATCH_KEY) || 'null') as { mac?: unknown; name?: unknown } | null;
    if (raw && typeof raw.mac === 'string' && typeof raw.name === 'string' && raw.mac) return { mac: raw.mac, name: raw.name };
  } catch {
    /* A damaged record means no quick reconnect. */
  }
  return null;
}

function signalBars(rssi: number | null) {
  if (rssi === null) return 0;
  return rssi >= -55 ? 4 : rssi >= -65 ? 3 : rssi >= -75 ? 2 : rssi >= -85 ? 1 : 0;
}

function bleReasonText(reason: string) {
  switch (reason) {
    case 'timeout': return 'The watch did not answer. Wake it, keep it close, then tap Reconnect.';
    case 'gatt-133':
    case 'service-discovery-failed':
    case 'discovery-failed': return 'Bluetooth link failed. Tap Reconnect to try again.';
    case 'link-lost': return 'Watch went out of range. Tap Reconnect when it is close.';
    case 'bluetooth-off': return 'Bluetooth is off. Turn it on, then tap Reconnect.';
    case 'bad-address': return 'That watch address is not valid. Scan to pair again.';
    default: return 'Watch disconnected.';
  }
}

function bleWatchId(mac: string) {
  return `ble-${mac.replace(/[^0-9a-f]/gi, '').toLowerCase()}`;
}

type AvatarTheme = 'pulse' | 'aurora' | 'ember' | 'tide';
type PayPlan = 'month' | 'year';

interface Session {
  provider: AuthProvider;
  name: string;
  email: string;
  signedInAt: string;
}

interface Batteries {
  apple: number;
  samsung: number;
  huawei: number;
}

interface LiftLog {
  id: number;
  lift: LiftName;
  weight: number;
  reps: number;
  oneRm: number;
  at: string;
}

type RecoveryClock = Record<MuscleGroup, number>;

interface Store {
  flowStep: FlowStep;
  userName: string;
  userEmail: string;
  gender: 'Male' | 'Female';
  heightCm: number;
  heightUnit: HeightUnit;
  weightKg: number;
  birthday: string;
  profileComplete: boolean;
  authProvider: AuthProvider | null;
  session: Session | null;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  steps: number;
  waterL: number;
  sleepHrs: number;
  activeBurn: number;
  streak: number;
  meals: MealItem[];
  fridge: Ingredient[];
  chat: ChatMessage[];
  workouts: WorkoutLog[];
  connectedWatch: string | null;
  customWatches: CustomWatch[];
  batteries: Batteries;
  avatar: AvatarTheme;
  trialStartedAt: number;
  proActive: boolean;
  plan: PayPlan | null;
  paymentLabel: string;
  trialForcedExpired: boolean;
  wristAlerts: WristAlert[];
  isFasting: boolean;
  fastingStartedAt: number | null;
  fastingSec: number;
  sleepBed: string;
  sleepWake: string;
  gpsAllowed: boolean;
  claudeApiKey: string;
  geminiApiKey: string;
  grokApiKey: string;
  trainingGoal: TrainingGoal;
  sessionFocus: SessionFocus;
  lifts: LiftLog[];
  recovery: RecoveryClock;
}

interface FoodEntry {
  kw: readonly string[];
  name: string;
  cal: number;
  p: number;
  c: number;
  f: number;
  s: number;
  adv: string;
}

interface CoachContext {
  name: string;
  gender: 'Male' | 'Female';
  weightKg: number;
  heightCm: number;
  age: number;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  steps: number;
  waterL: number;
  burned: number;
  sleepHrs: number;
}

const STORAGE_KEY = 'fitbite_pro_v3';
const PREFS_KEY = 'fitbite_pro_prefs_v1';
const VAULT_KEY = 'fitbite_vault_key';
const LEGACY_KEY = 'fitbite_pro_clean_v2';
const CAL_GOAL = 2100;
const STEP_GOAL = 10000;
const SAFE_TOP = 'pt-[max(env(safe-area-inset-top),40px)]';

const COACH_PROMPTS = [
  ['Desi High-Protein Dinner', 'Suggest one desi high-protein dinner that fits today. Three short lines.'],
  ['Beat Sugar Craving', 'I want a small everyday swap for a sugar craving. Keep it gentle and specific.'],
  ['10-Min Fat Burn', 'Give one gentle 10-minute walk or easy movement I can do today. No medical advice.'],
  ['Rate My Day', 'Rate my day from the numbers you already have, in three short lines.'],
] as const;

const CRAVINGS = ['5-Min Quick', 'High Protein', 'Desi Fit', 'Low Calorie', 'Sweet Craving'] as const;

function smartSwapLine(card: { protein: number; sugar: number; fat: number; verdict: string }) {
  const tip = card.verdict.trim();
  if (tip && tip.length <= 90 && !/fast|supplement|diagnos|medical|detox|dose/i.test(tip)) return `Smart Swap: ${tip}`;
  if (card.sugar >= 18) return 'Smart Swap: keep one sweet bite and add fruit or yogurt.';
  if (card.protein < 12) return 'Smart Swap: add eggs, lentils, yogurt, or chicken on the side.';
  if (card.fat >= 22) return 'Smart Swap: serve a smaller portion with extra vegetables.';
  return 'Smart Swap: keep this plate and add a glass of water.';
}
const CHALLENGE_KEY = 'fitbite_daily_challenge_v1';

interface SavedChallenge extends WellnessChallenge {
  date: string;
  completed: boolean;
  swaps: number;
  streakApplied: boolean;
}

function todayKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function challengeSeed(date: string, swap: number) {
  return date.split('-').reduce((sum, part) => sum + Number(part), 0) + swap * 17;
}

function readSavedChallenge(date: string): SavedChallenge | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = JSON.parse(window.localStorage.getItem(CHALLENGE_KEY) || 'null') as Partial<SavedChallenge> | null;
    if (!raw || raw.date !== date || typeof raw.title !== 'string' || typeof raw.tip !== 'string') return null;
    return {
      date,
      title: raw.title,
      tip: raw.tip,
      category: typeof raw.category === 'string' ? raw.category : 'Wellness',
      completed: raw.completed === true,
      swaps: typeof raw.swaps === 'number' && raw.swaps > 0 ? Math.min(2, Math.floor(raw.swaps)) : 0,
      streakApplied: raw.streakApplied === true,
    };
  } catch {
    return null;
  }
}

function writeSavedChallenge(challenge: SavedChallenge) {
  window.localStorage.setItem(CHALLENGE_KEY, JSON.stringify(challenge));
}

const FOOD_DB: readonly FoodEntry[] = [
  { kw: ['almond', 'badam', 'walnut', 'cashew', 'nut'], name: 'Almonds & Mixed Nuts', cal: 165, p: 6, c: 6, f: 14, s: 9.9, adv: 'Rich in vitamin E, healthy fats, and plant protein.' },
  { kw: ['fennel', 'saunf'], name: 'Fennel Seeds (Saunf)', cal: 345, p: 16, c: 52, f: 15, s: 9.7, adv: 'A digestion-friendly seed with a concentrated calorie count per 100g.' },
  { kw: ['flax', 'alsi', 'chia', 'seed'], name: 'Flaxseeds / Chia Seeds', cal: 534, p: 18, c: 29, f: 42, s: 9.8, adv: 'Omega-3 and fiber dense. A spoonful is usually enough.' },
  { kw: ['biryani', 'pulao', 'rice'], name: 'Chicken Biryani Bowl', cal: 540, p: 26, c: 68, f: 18, s: 7.4, adv: 'High-energy bowl. A walk after eating keeps the deficit intact.' },
  { kw: ['tikka', 'grilled', 'chicken', 'breast', 'kabab'], name: 'Grilled Chicken Breast', cal: 295, p: 44, c: 4, f: 9, s: 9.8, adv: 'Lean protein for recovery without a heavy carb load.' },
  { kw: ['egg', 'omelette', 'boiled'], name: '2 Boiled Eggs & Toast', cal: 210, p: 15, c: 12, f: 11, s: 9.6, adv: 'Complete protein and a light carb side for the morning.' },
  { kw: ['oat', 'porridge', 'cereal'], name: 'Oats & Berry Bowl', cal: 220, p: 8, c: 38, f: 4, s: 9.7, adv: 'Slow carbs and fiber that hold you past the next meal.' },
  { kw: ['daal', 'lentil', 'beans', 'chickpea'], name: 'Lentil Soup (Daal)', cal: 230, p: 15, c: 36, f: 4, s: 9.5, adv: 'Plant protein, iron, and a light fat profile.' },
  { kw: ['black coffee', 'americano', 'espresso'], name: 'Black Coffee', cal: 5, p: 0, c: 1, f: 0, s: 10, adv: 'Nearly calorie-free. Skip the sugar if you are in a cut.' },
  { kw: ['green tea', 'herbal tea', 'herbal'], name: 'Organic Green Tea', cal: 5, p: 0, c: 1, f: 0, s: 10, adv: 'A zero-calorie cup that still counts toward the ritual, not the budget.' },
  { kw: ['tea', 'chai', 'latte', 'coffee'], name: 'Milk Tea / Coffee', cal: 115, p: 4, c: 14, f: 5, s: 7.8, adv: 'Fine as a daily drink. The calories live in the milk and sugar.' },
  { kw: ['salad', 'fruit', 'apple', 'banana', 'veggie'], name: 'Fresh Green & Fruit Salad', cal: 120, p: 3, c: 26, f: 1, s: 9.9, adv: 'Volume, micronutrients, and very little fat.' },
  { kw: ['burger', 'pizza', 'fries', 'wrap', 'fast'], name: 'Fast Food Platter', cal: 580, p: 22, c: 60, f: 28, s: 5, adv: 'A heavy plate. Balance it with water and the rest of your step goal.' },
];

const PROVIDERS: Record<AuthProvider, { label: string }> = {
  google: { label: 'Device profile' },
  apple: { label: 'Saved profile' },
  huawei: { label: 'Local profile' },
};

const WATCHES: readonly { id: WatchId; name: string; model: string }[] = [
  { id: 'apple', name: 'BLE Smart Watch', model: 'Round face' },
  { id: 'samsung', name: 'Fitness Band', model: 'Band' },
  { id: 'huawei', name: 'Training Watch', model: 'Rectangular' },
];

const LIFTS: readonly LiftName[] = ['Bench Press', 'Squat', 'Deadlift'];
const MUSCLES: readonly MuscleGroup[] = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms'];

interface FuelPlate {
  title: string;
  items: string;
  why: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fats?: number;
}

const FUEL: Record<TrainingGoal, { pre: FuelPlate[]; post: FuelPlate[] }> = {
  muscle: {
    pre: [
      { title: 'Oats, banana, and almonds', items: '60g oats · 1 banana · 15g almonds', why: 'Eat this 90 minutes before you train. Oats and the banana carry the session; almonds keep it from crashing.' },
      { title: 'Sweet potato and eggs', items: '200g sweet potato · 2 eggs', why: 'A fuller plate about 2 hours before a heavy squat or deadlift.' },
      { title: 'Brown rice and Greek yogurt', items: '150g cooked brown rice · 170g Greek yogurt', why: 'Steady carbs with a light protein side when the workout is 1–2 hours away.' },
      { title: 'Oats, banana, and chia', items: '40g oats · 1 banana · 10g chia seeds', why: 'Easier to finish when you only have an hour. Chia adds fiber without a greasy meal.' },
    ],
    post: [
      { title: 'Grilled chicken and brown rice', items: '150g chicken breast · 200g cooked brown rice', why: 'Protein and carbs in the two hours after training, to refill what the session spent.' },
      { title: 'Eggs and sweet potato', items: '3 eggs · 250g sweet potato', why: 'A whole-food recovery plate when chicken is not what you have.' },
      { title: 'Fish and rice', items: '160g fish · 180g cooked rice', why: 'White fish or salmon with the starch the workout used up.' },
      { title: 'Greek yogurt, banana, and almonds', items: '250g Greek yogurt · 1 banana · 10g almonds', why: 'Cold and fast when you cannot cook right after the gym.' },
      { title: 'Paneer, lentils, and olive oil', items: '120g paneer · 200g cooked lentils · 1 tsp olive oil', why: 'Dairy and legume protein for a vegetarian training day.' },
      { title: 'Chicken, rice, and olive oil', items: '140g chicken breast · 180g rice · 1 tsp olive oil', why: 'The same recovery pattern, with a measured fat so the meal is not dry.' },
    ],
  },
  fat: {
    pre: [
      { title: 'Banana and Greek yogurt', items: '1 banana · 150g Greek yogurt', why: 'A smaller carb serving 60–90 minutes before training, enough to work without a heavy plate.' },
      { title: 'Oats, banana, and eggs', items: '30g oats · 1 banana · 2 eggs', why: 'Fuel for the session, with protein that does not turn the meal into a large bowl.' },
      { title: 'Sweet potato and fish', items: '120g sweet potato · 100g white fish', why: 'Eat this about 2 hours before a longer lift. Keep the potato modest on a cut.' },
      { title: 'Oats and almonds', items: '35g oats · 1 banana · 10g almonds', why: 'A light early plate when you train before the day gets busy.' },
    ],
    post: [
      { title: 'Grilled chicken, salad, and sweet potato', items: '160g chicken breast · a large salad · 100g sweet potato', why: 'Protein first, with a controlled carb so recovery does not erase the deficit.' },
      { title: 'Eggs and Greek yogurt', items: '2 eggs · 200g Greek yogurt', why: 'High protein and little starch, useful after an evening session.' },
      { title: 'Fish and lentils', items: '150g fish · 150g cooked lentils', why: 'Two protein sources and fiber, with less rice than a muscle-gain plate.' },
      { title: 'Paneer, greens, and brown rice', items: '100g paneer · greens · 1 tsp olive oil · 80g brown rice', why: 'A vegetarian recovery meal that still fits a fat-loss day.' },
      { title: 'Chicken and a small bowl of rice', items: '150g chicken breast · 100g cooked brown rice', why: 'Less rice than the muscle plate, still enough to train again.' },
      { title: 'Greek yogurt, fruit, and chia', items: '250g Greek yogurt · fruit · 10g chia seeds', why: 'When appetite is low after conditioning. The protein is still the point of the meal.' },
    ],
  },
};

function plateFromAi(value: unknown, fallback: FuelPlate): FuelPlate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const data = value as Record<string, unknown>;
  const title = typeof data.title === 'string' ? data.title.trim().slice(0, 80) : '';
  const items = typeof data.items === 'string' ? data.items.trim().slice(0, 180) : '';
  const why = typeof data.why === 'string' ? data.why.trim().slice(0, 240) : '';
  if (!title || !items) return fallback;
  const num = (key: string) => {
    const raw = data[key];
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : undefined;
  };
  return { title, items, why: why || fallback.why, calories: num('calories'), protein: num('protein'), carbs: num('carbs'), fats: num('fats') };
}

function emptyRecovery(): RecoveryClock {
  return { Chest: 0, Back: 0, Legs: 0, Shoulders: 0, Arms: 0 };
}

/** Epley estimate. Weights are kg internally, kept to two decimals so pounds convert back cleanly. */
function estimate1Rm(weightKg: number, reps: number) {
  const value = reps <= 1 ? weightKg : weightKg * (1 + reps / 30);
  return Math.round(value * 100) / 100;
}

const CARDIO_SPORTS = new Set(['Run', 'Walk', 'Bike', 'Hike']);
const FOCUS_MUSCLES: Record<SessionFocus, readonly MuscleGroup[]> = {
  Push: ['Chest', 'Shoulders', 'Arms'],
  Pull: ['Back', 'Arms'],
  Legs: ['Legs'],
};

function recoveryFor(group: MuscleGroup, workouts: readonly WorkoutLog[]) {
  const hits = workouts.filter((workout) => {
    const saved = new Date(workout.savedAt).getTime();
    if (!Number.isFinite(saved) || Date.now() - saved > 48 * 36e5 || Date.now() < saved) return false;
    if (CARDIO_SPORTS.has(workout.sport)) return group === 'Legs';
    if (workout.sport === 'Custom Workout') {
      const focus = workout.focus === 'Pull' || workout.focus === 'Legs' ? workout.focus : 'Push';
      return FOCUS_MUSCLES[focus].includes(group);
    }
    return false;
  });
  if (hits.length === 0) return { ready: true, pct: 100, line: `${group}: 100% Ready` };
  const latest = hits[0];
  const hoursAgo = (Date.now() - new Date(latest.savedAt).getTime()) / 36e5;
  const loadH = Math.min(48, Math.max(6, (latest.seconds / 3600) * 18));
  const left = loadH - hoursAgo;
  if (left <= 0) return { ready: true, pct: 100, line: `${group}: 100% Ready` };
  return { ready: false, pct: Math.max(8, Math.round((hoursAgo / loadH) * 100)), line: `${group}: ${Math.ceil(left)}h Recovery Needed` };
}

const SPORTS: Record<string, { mps: number; met: number }> = {
  Run: { mps: 2.8, met: 9.8 },
  Hike: { mps: 1.2, met: 6 },
  Bike: { mps: 5.4, met: 7.5 },
  Walk: { mps: 1.4, met: 3.8 },
  'Custom Workout': { mps: 1.6, met: 5 },
};

const fieldClass =
  'w-full rounded-2xl border border-slate-200 bg-white/80 px-4 py-3.5 text-sm text-slate-900 shadow-[inset_0_1px_0_#fff] outline-none placeholder:text-slate-400 focus:border-indigo-400';
const primaryClass =
  'btn-primary tap-press inline-flex h-12 items-center justify-center gap-2 rounded-full px-5 text-sm font-extrabold on-gradient disabled:opacity-50';
const quietClass =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white/85 px-5 text-sm font-extrabold text-slate-800 shadow-[0_8px_20px_rgba(15,23,42,0.05)] disabled:opacity-50';

type VoicePhase = 'idle' | 'listening' | 'recording';
type VoiceTarget = 'coach' | 'scan';

function speechLanguage() {
  const lang = (typeof navigator === 'undefined' ? 'en-US' : navigator.language || 'en-US').toLowerCase();
  return lang.startsWith('ur') ? 'ur-PK' : 'en-US';
}

function audioMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  return '';
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result || '').split(',')[1] || '';
      if (data.length < 32) reject(new Error('empty'));
      else resolve(data);
    };
    reader.onerror = () => reject(reader.error || new Error('empty'));
    reader.readAsDataURL(blob);
  });
}

function Glyph({ name, className = 'h-4 w-4' }: { name: 'camera' | 'image' | 'mic'; className?: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {name === 'camera' && (<><path d="M4 8.5h3.2L8.8 6h6.4l1.6 2.5H20v10.5H4V8.5z" {...common} /><circle cx="12" cy="13.2" r="3.1" {...common} /></>)}
      {name === 'image' && (<><rect x="4" y="5" width="16" height="14" rx="2" {...common} /><circle cx="9" cy="10" r="1.3" {...common} /><path d="M4 16.5l4.2-3.8 3.2 2.8 2.4-2 6.2 5" {...common} /></>)}
      {name === 'mic' && (<><rect x="9" y="3.5" width="6" height="10" rx="3" {...common} /><path d="M6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V20" {...common} /></>)}
    </svg>
  );
}

function MicButton({ hot, phase, label, disabled, onClick }: { hot: boolean; phase: VoicePhase; label: string; disabled?: boolean; onClick: () => void }) {
  const live = hot && phase !== 'idle';
  return (
    <button
      type="button"
      className={live ? 'inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-[#ff2d55] px-3 text-[11px] font-extrabold on-gradient shadow-[0_8px_24px_rgba(255,45,85,0.35)] animate-pulse' : `${quietClass} shrink-0 px-4`}
      aria-label={live ? 'Stop dictation' : label}
      disabled={Boolean(disabled) && !live}
      onClick={onClick}
    >
      {live ? (phase === 'recording' ? 'Recording... Tap to stop' : 'Listening... Tap to stop') : <Glyph name="mic" />}
    </button>
  );
}
function defaultStore(): Store {
  return {
    flowStep: 'welcome',
    userName: 'Alex Rivera',
    userEmail: '',
    gender: 'Male',
    heightCm: 175,
    heightUnit: 'cm',
    weightKg: 70,
    birthday: '1998-05-15',
    profileComplete: false,
    authProvider: null,
    session: null,
    calories: 760,
    protein: 64,
    carbs: 56,
    fats: 22,
    steps: 6840,
    waterL: 1.75,
    sleepHrs: 0,
    sleepBed: '',
    sleepWake: '',
    activeBurn: 0,
    streak: 12,
    meals: [
      { id: 1, name: 'Oats & 2 Boiled Eggs', calories: 340, protein: 22, carbs: 38, fats: 10, time: '8:30 AM' },
      { id: 2, name: 'Grilled Chicken & Salad', calories: 420, protein: 42, carbs: 18, fats: 12, time: '1:15 PM' },
    ],
    fridge: [
      { id: 1, name: 'Chicken Breast' },
      { id: 2, name: 'Greek Yogurt' },
      { id: 3, name: 'Oats' },
      { id: 4, name: 'Spinach' },
    ],
    chat: coachWelcome(),
    workouts: [],
    connectedWatch: null,
    customWatches: [],
    batteries: { apple: 86, samsung: 72, huawei: 91 },
    avatar: 'aurora',
    trialStartedAt: 0,
    proActive: false,
    plan: null,
    paymentLabel: '',
    trialForcedExpired: false,
    wristAlerts: [],
    isFasting: false,
    fastingStartedAt: null,
    fastingSec: 0,
    gpsAllowed: false,
    claudeApiKey: '',
    geminiApiKey: '',
    grokApiKey: '',
    trainingGoal: 'muscle',
    sessionFocus: 'Push',
    lifts: [],
    recovery: emptyRecovery(),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function num(v: unknown, fallback: number, min: number, max: number) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function isMeal(v: unknown): v is MealItem {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === 'number' &&
    typeof v.name === 'string' &&
    typeof v.calories === 'number' &&
    typeof v.protein === 'number' &&
    typeof v.carbs === 'number' &&
    typeof v.fats === 'number' &&
    typeof v.time === 'string'
  );
}

function isChat(v: unknown): v is ChatMessage {
  if (!isRecord(v)) return false;
  return typeof v.id === 'number' && (v.sender === 'user' || v.sender === 'ai') && typeof v.text === 'string';
}

function isWorkout(v: unknown): v is WorkoutLog {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === 'number' &&
    typeof v.sport === 'string' &&
    typeof v.seconds === 'number' &&
    typeof v.distanceKm === 'number' &&
    typeof v.calories === 'number' &&
    typeof v.savedAt === 'string'
  );
}

function isLiftName(v: unknown): v is LiftName {
  return v === 'Bench Press' || v === 'Squat' || v === 'Deadlift';
}

function isLiftLog(v: unknown): v is LiftLog {
  if (!isRecord(v)) return false;
  return typeof v.id === 'number' && isLiftName(v.lift) && typeof v.weight === 'number' && typeof v.reps === 'number' && typeof v.oneRm === 'number' && typeof v.at === 'string';
}

function readRecovery(v: unknown): RecoveryClock {
  const clock = emptyRecovery();
  if (!isRecord(v)) return clock;
  for (const group of MUSCLES) clock[group] = num(v[group], 0, 0, 1e15);
  return clock;
}

function isWatchId(v: unknown): v is WatchId {
  return v === 'apple' || v === 'samsung' || v === 'huawei';
}

function isAlert(v: unknown): v is WristAlert {
  if (!isRecord(v)) return false;
  return typeof v.id === 'number' && typeof v.device === 'string' && v.device.length > 0 && typeof v.text === 'string' && typeof v.at === 'string';
}

function uniqueAlerts(alerts: WristAlert[]) {
  const seen = new Set<string>();
  const next: WristAlert[] = [];
  for (const alert of alerts) {
    const key = `${alert.device}|${alert.at}|${alert.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(alert);
  }
  return next.slice(0, 8);
}

function isAvatar(v: unknown): v is AvatarTheme {
  return v === 'pulse' || v === 'aurora' || v === 'ember' || v === 'tide';
}

function readCustomWatches(v: unknown): CustomWatch[] {
  if (!Array.isArray(v)) return [];
  const watches: CustomWatch[] = [];
  for (const item of v) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.brand !== 'string') continue;
    const name = item.name.trim().slice(0, 40);
    const brand = item.brand.trim().slice(0, 40);
    if (!name || !brand) continue;
    const mac = typeof item.mac === 'string' && /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(item.mac) ? item.mac.toUpperCase() : undefined;
    watches.push({ id: item.id.slice(0, 40), name, brand, battery: num(item.battery, 80, 1, 100), ...(mac ? { mac } : {}) });
  }
  return watches.slice(0, 12);
}

function emailOk(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

function maintainKcal(weightKg: number, heightCm: number, age: number, gender: 'Male' | 'Female') {
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (gender === 'Female' ? -161 : 5);
  return Math.max(1200, Math.round(bmr * 1.45));
}

function waterTargetL(weightKg: number) {
  return Math.round(Math.min(4, Math.max(2, weightKg * 0.033)) * 10) / 10;
}

function readSession(v: unknown): Session | null {
  if (!isRecord(v)) return null;
  if (v.provider !== 'google' && v.provider !== 'apple' && v.provider !== 'huawei') return null;
  if (typeof v.name !== 'string' || typeof v.email !== 'string' || typeof v.signedInAt !== 'string') return null;
  return { provider: v.provider, name: v.name, email: keptEmail(v.email), signedInAt: v.signedInAt };
}

function readFridge(v: unknown, fallback: Ingredient[]) {
  if (!Array.isArray(v)) return fallback;
  const items: Ingredient[] = [];
  v.forEach((item, index) => {
    if (typeof item === 'string' && item.trim()) items.push({ id: index + 1, name: item.trim() });
    else if (isRecord(item) && typeof item.id === 'number' && typeof item.name === 'string' && item.name.trim()) {
      items.push({ id: item.id, name: item.name.trim() });
    }
  });
  return items;
}

function isFlow(v: unknown): v is FlowStep {
  return v === 'welcome' || v === 'auth' || v === 'profile' || v === 'device' || v === 'app';
}

function sanitize(raw: unknown): Store | null {
  if (!isRecord(raw)) return null;
  const base = defaultStore();
  const flowStep = isFlow(raw.flowStep) ? raw.flowStep : base.flowStep;
  const batteries = isRecord(raw.batteries)
    ? {
      apple: num(raw.batteries.apple, base.batteries.apple, 1, 100),
      samsung: num(raw.batteries.samsung, base.batteries.samsung, 1, 100),
      huawei: num(raw.batteries.huawei, base.batteries.huawei, 1, 100),
    }
    : base.batteries;
  const birthday = typeof raw.birthday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.birthday) ? raw.birthday : base.birthday;
  const customWatches = readCustomWatches(raw.customWatches);
  const connectedWatch = typeof raw.connectedWatch === 'string' && (isWatchId(raw.connectedWatch) || customWatches.some((watch) => watch.id === raw.connectedWatch))
    ? raw.connectedWatch
    : raw.connectedWatch === null
      ? null
      : base.connectedWatch;
  const trialStartedAt = typeof raw.trialStartedAt === 'number' && Number.isFinite(raw.trialStartedAt) && raw.trialStartedAt > 0 ? raw.trialStartedAt : Date.now();
  const meals = Array.isArray(raw.meals)
    ? raw.meals.filter(isMeal).map((m) => ({
      ...m,
      name: m.name.slice(0, 80),
      calories: num(m.calories, 0, 0, 5000),
      protein: num(m.protein, 0, 0, 500),
      carbs: num(m.carbs, 0, 0, 500),
      fats: num(m.fats, 0, 0, 500),
    }))
    : base.meals;
  const eaten = nutritionFromMeals(meals);
  return {
    flowStep,
    userName: typeof raw.userName === 'string' && raw.userName.trim() ? raw.userName.slice(0, 40) : base.userName,
    userEmail: keptEmail(typeof raw.userEmail === 'string' ? raw.userEmail : ''),
    gender: raw.gender === 'Female' ? 'Female' : 'Male',
    heightCm: num(raw.heightCm, base.heightCm, 120, 220),
    heightUnit: raw.heightUnit === 'ft' ? 'ft' : 'cm',
    weightKg: num(raw.weightKg, base.weightKg, 35, 250),
    birthday,
    profileComplete: typeof raw.profileComplete === 'boolean' ? raw.profileComplete : flowStep === 'app',
    authProvider: raw.authProvider === 'google' || raw.authProvider === 'apple' || raw.authProvider === 'huawei' ? raw.authProvider : null,
    session: readSession(raw.session),
    calories: eaten.calories,
    protein: eaten.protein,
    carbs: eaten.carbs,
    fats: eaten.fats,
    steps: num(raw.steps, base.steps, 0, 200000),
    waterL: num(raw.waterL, base.waterL, 0, 20),
    sleepHrs: sleepHours(keptClock(raw.sleepBed), keptClock(raw.sleepWake)),
    sleepBed: keptClock(raw.sleepBed),
    sleepWake: keptClock(raw.sleepWake),
    activeBurn: num(raw.activeBurn, base.activeBurn, 0, 20000),
    streak: num(raw.streak, base.streak, 0, 999),
    meals,
    fridge: readFridge(raw.fridge ?? raw.fridgeItems, base.fridge),
    chat: Array.isArray(raw.chat) ? raw.chat.filter(isChat).slice(-40) : base.chat,
    workouts: Array.isArray(raw.workouts) ? raw.workouts.filter(isWorkout).slice(0, 12) : [],
    connectedWatch,
    customWatches,
    batteries,
    avatar: isAvatar(raw.avatar) ? raw.avatar : base.avatar,
    trialStartedAt,
    proActive: (() => {
      const subscription = readUserSubscription();
      const active = raw.proActive === true || subscription.isPro;
      if (active && !subscription.isPro) writeUserSubscription({ isPro: true, plan: subscription.plan ?? 'monthly' });
      return active;
    })(),
    plan: raw.plan === 'month' || raw.plan === 'year' ? raw.plan : null,
    paymentLabel: typeof raw.paymentLabel === 'string' ? raw.paymentLabel.slice(0, 40) : '',
    trialForcedExpired: raw.trialForcedExpired === true,
    wristAlerts: uniqueAlerts(
      Array.isArray(raw.wristAlerts)
        ? raw.wristAlerts.filter(isAlert).map((alert) => ({ ...alert, text: alert.text.replace(/\d+(?:\.\d+)?\s*BPM/gi, '-- BPM') }))
        : [],
    ),
    isFasting: raw.isFasting === true && typeof raw.fastingStartedAt === 'number' && Number.isFinite(raw.fastingStartedAt) && raw.fastingStartedAt > 0,
    fastingStartedAt: typeof raw.fastingStartedAt === 'number' && Number.isFinite(raw.fastingStartedAt) && raw.fastingStartedAt > 0 ? raw.fastingStartedAt : null,
    fastingSec: 0,
    gpsAllowed: raw.gpsAllowed === true,
    claudeApiKey: typeof raw.claudeApiKey === 'string' ? raw.claudeApiKey.trim().slice(0, 400) : '',
    geminiApiKey: typeof raw.geminiApiKey === 'string' ? raw.geminiApiKey.trim().slice(0, 400) : '',
    grokApiKey: typeof raw.grokApiKey === 'string' ? raw.grokApiKey.trim().slice(0, 400) : '',
    trainingGoal: raw.trainingGoal === 'fat' ? 'fat' : 'muscle',
    sessionFocus: raw.sessionFocus === 'Pull' || raw.sessionFocus === 'Legs' ? raw.sessionFocus : 'Push',
    lifts: Array.isArray(raw.lifts)
      ? raw.lifts.filter(isLiftLog).slice(0, 30).map((lift) => ({
        ...lift,
        weight: num(lift.weight, 0, 0, 500),
        reps: Math.round(num(lift.reps, 1, 1, 30)),
        oneRm: num(lift.oneRm, 0, 0, 800),
      }))
      : [],
    recovery: readRecovery(raw.recovery),
  };
}

function bytesToB64(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64ToBytes(value: string) {
  const bin = atob(value);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function vaultCryptoKey() {
  let stored = window.localStorage.getItem(VAULT_KEY);
  if (!stored) {
    stored = bytesToB64(crypto.getRandomValues(new Uint8Array(32)));
    window.localStorage.setItem(VAULT_KEY, stored);
  }
  return crypto.subtle.importKey('raw', b64ToBytes(stored), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function writeStore(raw: string, vault: boolean) {
  if (!vault) {
    window.localStorage.setItem(STORAGE_KEY, raw);
    return;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await vaultCryptoKey(), new TextEncoder().encode(raw)));
  window.localStorage.setItem(STORAGE_KEY, `enc:${bytesToB64(iv)}:${bytesToB64(cipher)}`);
}

async function readStoredText() {
  const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_KEY);
  if (!raw) return '';
  if (!raw.startsWith('enc:')) return raw;
  const [, iv, cipher] = raw.split(':');
  if (!iv || !cipher) return '';
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(iv) }, await vaultCryptoKey(), b64ToBytes(cipher));
  return new TextDecoder().decode(plain);
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

type PantryRole = 'meat' | 'fish' | 'egg' | 'dairy' | 'grain' | 'fruit' | 'veg' | 'fat' | 'legume' | 'other';

interface MeasuredIngredient {
  key: string;
  role: PantryRole;
  label: string;
  serving: string;
  cal: number;
  p: number;
  c: number;
  f: number;
}

const PANTRY: { test: RegExp; key: string; role: PantryRole; serving: string; cal: number; p: number; c: number; f: number }[] = [
  { test: /chicken|murgh/i, key: 'chicken', role: 'meat', serving: '150g', cal: 248, p: 46, c: 0, f: 6 },
  { test: /mutton|lamb|goat|beef/i, key: 'mutton', role: 'meat', serving: '150g', cal: 368, p: 38, c: 0, f: 23 },
  { test: /fish|salmon|tuna|prawn|shrimp/i, key: 'fish', role: 'fish', serving: '150g', cal: 220, p: 39, c: 0, f: 7 },
  { test: /\beggs?\b|omelette/i, key: 'egg', role: 'egg', serving: '2 eggs', cal: 156, p: 13, c: 1, f: 11 },
  { test: /paneer|tofu/i, key: 'paneer', role: 'dairy', serving: '100g', cal: 265, p: 18, c: 4, f: 20 },
  { test: /greek yogurt|yogurt|yoghurt|curd|dahi/i, key: 'yogurt', role: 'dairy', serving: '170g', cal: 100, p: 17, c: 6, f: 0 },
  { test: /\bmilk\b/i, key: 'milk', role: 'dairy', serving: '240ml', cal: 122, p: 8, c: 12, f: 5 },
  { test: /oat|porridge/i, key: 'oats', role: 'grain', serving: '50g dry', cal: 190, p: 7, c: 32, f: 4 },
  { test: /brown rice|\brice\b|quinoa/i, key: 'rice', role: 'grain', serving: '150g cooked', cal: 195, p: 4, c: 43, f: 1 },
  { test: /sweet potato/i, key: 'sweetpotato', role: 'grain', serving: '150g', cal: 130, p: 2, c: 30, f: 0 },
  { test: /banana/i, key: 'banana', role: 'fruit', serving: '1 medium', cal: 105, p: 1, c: 27, f: 0 },
  { test: /apple|berry|berries|mango|fruit/i, key: 'fruit', role: 'fruit', serving: '1 piece', cal: 80, p: 1, c: 20, f: 0 },
  { test: /almond|walnut|cashew|nut/i, key: 'nuts', role: 'fat', serving: '15g', cal: 90, p: 3, c: 3, f: 8 },
  { test: /chia|flax|seed/i, key: 'chia', role: 'fat', serving: '10g', cal: 49, p: 2, c: 4, f: 3 },
  { test: /olive oil|\boil\b|ghee/i, key: 'oil', role: 'fat', serving: '1 tsp', cal: 40, p: 0, c: 0, f: 5 },
  { test: /lentil|daal|dal|chickpea|bean/i, key: 'lentil', role: 'legume', serving: '150g cooked', cal: 175, p: 12, c: 28, f: 1 },
  { test: /spinach|broccoli|salad|greens|vegetable|veggie/i, key: 'veg', role: 'veg', serving: 'a large handful', cal: 25, p: 3, c: 3, f: 0 },
];

function measureIngredient(name: string): MeasuredIngredient {
  const label = name.trim();
  const found = PANTRY.find((row) => row.test.test(label));
  if (found) return { key: found.key, role: found.role, label, serving: found.serving, cal: found.cal, p: found.p, c: found.c, f: found.f };
  const h = hashString(label.toLowerCase() || 'pantry');
  return { key: 'other', role: 'other', label, serving: 'a modest portion', cal: 55 + (h % 70), p: 2 + (h % 6), c: 4 + ((h >>> 4) % 12), f: 1 + ((h >>> 8) % 5) };
}

function nameList(items: MeasuredIngredient[]) {
  if (items.length === 0) return '';
  const labels = items.map((item) => item.label);
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

interface KitchenRecipe {
  title: string;
  cal: number;
  protein: number;
  carbs: number;
  fats: number;
  steps: string[];
  halal?: boolean;
}

interface DeskPrefs {
  meals: boolean;
  water: boolean;
  watch: boolean;
  background: boolean;
  appleHealth: boolean;
  googleHealth: boolean;
  appLock: boolean;
  pin: string;
  vault: boolean;
}

function cookFromFridge(names: string[]): KitchenRecipe {
  const items = names.map(measureIngredient).filter((item) => item.label);
  const of = (role: PantryRole) => items.filter((item) => item.role === role);
  const meats = of('meat');
  const fish = of('fish');
  const eggs = of('egg');
  const dairy = of('dairy');
  const grains = of('grain');
  const fruit = of('fruit');
  const veg = of('veg');
  const fats = of('fat');
  const legumes = of('legume');
  const oats = items.find((item) => item.key === 'oats');
  const milk = items.find((item) => item.key === 'milk');
  const yogurt = items.find((item) => item.key === 'yogurt');
  const banana = items.find((item) => item.key === 'banana');
  const oil = fats.find((item) => item.key === 'oil');
  let title = `${items.slice(0, 2).map((item) => item.label).join(' & ')} plate`;
  let steps: string[] = [];
  let used = items;

  if (oats && !meats.length && !fish.length && (milk || yogurt || banana || fruit.length)) {
    const blend = Boolean(milk && (banana || fruit.length));
    if (blend) {
      title = banana ? 'Banana oat smoothie' : `${fruit[0]?.label ?? 'Fruit'} oat smoothie`;
      used = [milk, oats, ...fruit, ...fats].filter((item): item is MeasuredIngredient => Boolean(item));
      const fruitNames = nameList(fruit);
      steps = [
        `Pour ${milk?.serving ?? '240ml'} ${milk?.label ?? 'milk'} into a blender with ${oats.serving} ${oats.label}.`,
        `Add ${fruitNames}. Blend on high until the oats disappear and the drink is thick, about 30 seconds.`,
        fats.length ? `Pulse in ${nameList(fats)} (${fats.map((item) => item.serving).join(', ')}).` : 'Loosen with a splash more milk if the blender stalls.',
        'Pour it into a glass and drink it cold. The numbers are this one glass.',
      ];
    } else {
      title = banana ? 'Banana oat porridge' : `${oats.label} porridge`;
      used = [oats, milk, yogurt, ...fruit, ...fats].filter((item): item is MeasuredIngredient => Boolean(item));
      const liquid = milk ? `${milk.serving} ${milk.label}` : '180ml water';
      steps = [
        `Stir ${oats.serving} ${oats.label} into ${liquid} in a small pan.`,
        'Cook on low for 4–5 minutes, stirring, until the oats thicken.',
        yogurt ? `Take the pan off the heat, then stir in ${yogurt.serving} ${yogurt.label} so it stays creamy and does not split.` : 'Take the pan off the heat.',
        fruit.length ? `Slice ${nameList(fruit)} over the top.` : 'Add a pinch of salt or cinnamon.',
        fats.length ? `Finish with ${fats.map((item) => `${item.serving} ${item.label}`).join(' and ')}.` : 'Serve warm as one bowl.',
      ];
    }
  } else if (meats.length && yogurt) {
    const meat = meats[0];
    title = `${meat.label} ${yogurt.label} curry`;
    used = [...meats, yogurt, ...veg, ...(oil ? [oil] : []), ...grains.filter((item) => item.key !== 'oats')];
    steps = [
      `Cut ${meat.serving} ${meat.label} into bite-size pieces and salt them.`,
      oil ? `Heat ${oil.serving} ${oil.label} in a pan and brown the ${meat.label}, about 4 minutes.` : `Brown the ${meat.label} in a dry nonstick pan, about 4 minutes.`,
      veg.length ? `Add ${nameList(veg)} and cook until just soft.` : 'Stir in a pinch of garlic, cumin, or chili if you have them.',
      `Add ${yogurt.serving} ${yogurt.label}. Cover and simmer on low for 12–15 minutes, until the ${meat.label} is cooked through and the sauce is thick.`,
      grains.some((item) => item.key !== 'oats') ? `Serve with ${grains.filter((item) => item.key !== 'oats').map((item) => `${item.serving} ${item.label}`).join(' and ')}.` : 'Rest for 2 minutes. This pan is one serving.',
      meats.length > 1 ? `Cook ${nameList(meats.slice(1))} in the same sauce for the last 8 minutes.` : '',
      oats ? `Leave the ${oats.label} out of the curry. Use ${oats.serving} another time as porridge.` : '',
    ];
  } else if (fish.length && yogurt && !meats.length) {
    const fillet = fish[0];
    title = `${fillet.label} with ${yogurt.label}`;
    used = [...fish, yogurt, ...veg, ...(oil ? [oil] : []), ...grains];
    steps = [
      `Season ${fillet.serving} ${fillet.label} with salt.`,
      `Stir ${yogurt.serving} ${yogurt.label} with a pinch of salt${veg.length ? ` and spoon it over ${nameList(veg)}` : ''}.`,
      `Sear the ${fillet.label} in ${oil ? oil.label : 'a lightly oiled pan'} for about 3 minutes a side. Do not boil it in the yogurt.`,
      'Spoon the yogurt over the fish off the heat so it stays thick.',
      grains.length ? `Eat it with ${nameList(grains)}.` : 'Serve straight away. This is one plate.',
    ];
  } else if ((meats.length || fish.length || eggs.length || legumes.length) && (grains.length || veg.length || dairy.length)) {
    const hero = meats[0] ?? fish[0] ?? eggs[0] ?? legumes[0];
    title = `${hero.label} ${grains[0] ? `and ${grains[0].label}` : 'skillet'}`;
    used = [...meats, ...fish, ...eggs, ...legumes, ...grains, ...veg, ...dairy, ...fats];
    steps = [
      meats.length || fish.length
        ? `Season ${[...meats, ...fish].map((item) => `${item.serving} ${item.label}`).join(' and ')}. Sear until browned, then cook through on lower heat.`
        : eggs.length
          ? `Beat ${eggs.map((item) => `${item.serving} ${item.label}`).join(' and ')} with a pinch of salt.`
          : `Warm ${legumes.map((item) => `${item.serving} ${item.label}`).join(' and ')} in a pan with salt.`,
      grains.length ? `Warm ${grains.map((item) => `${item.serving} ${item.label}`).join(' and ')} in the same pan so it picks up the browned bits.` : 'Keep the pan on medium and let extra moisture cook off.',
      veg.length ? `Add ${nameList(veg)} and cook until just tender.` : '',
      dairy.length ? `Take the pan off the heat and fold in ${dairy.map((item) => `${item.serving} ${item.label}`).join(' and ')}.` : fats.length ? `Finish with ${fats.map((item) => `${item.serving} ${item.label}`).join(' and ')}.` : 'Taste for salt.',
      'Plate it while it is hot. The macros are this one serving.',
    ];
  } else if (eggs.length) {
    title = dairy.length ? `${eggs[0].label} and ${dairy[0].label}` : `${eggs[0].label} skillet`;
    used = [...eggs, ...veg, ...dairy, ...fats];
    steps = [
      veg.length ? `Cook ${nameList(veg)} in a nonstick pan for 2 minutes.` : 'Warm a nonstick pan over medium heat.',
      `Add ${eggs.map((item) => `${item.serving} ${item.label}`).join(' and ')} and cook gently so the curds or yolk stay soft.`,
      dairy.length ? `Fold in ${dairy.map((item) => `${item.serving} ${item.label}`).join(' and ')} off the heat.` : 'Season with salt and pepper.',
      fats.length ? `Finish with ${nameList(fats)}.` : 'Slide it onto a plate. One pan is one serving.',
    ];
  } else {
    steps = [
      `Set out ${items.map((item) => `${item.serving} ${item.label}`).join(', ')}.`,
      grains.length || legumes.length ? `Warm ${nameList([...grains, ...legumes])} and season with salt.` : 'Keep anything that is better raw, raw.',
      dairy.length || fruit.length ? `Spoon ${nameList([...dairy, ...fruit])} on top.` : 'Arrange it on one plate.',
      fats.length ? `Add ${nameList(fats)} last so the texture stays.` : 'Taste and adjust salt.',
      'Eat it as a single serving. These numbers are this plate, not a fixed recipe.',
    ];
  }

  const plate = used.reduce((sum, item) => ({ cal: sum.cal + item.cal, p: sum.p + item.p, c: sum.c + item.c, f: sum.f + item.f }), { cal: 0, p: 0, c: 0, f: 0 });
  return {
    title,
    cal: Math.round(plate.cal),
    protein: Math.round(plate.p),
    carbs: Math.round(plate.c),
    fats: Math.round(plate.f),
    steps: steps.filter((step) => step.trim()),
  };
}

function includesTerm(query: string, term: string) {
  if (term.includes(' ')) return query.toLowerCase().includes(term);
  return new RegExp(`(?:^|[^a-z])${term}s?(?:[^a-z]|$)`, 'i').test(query);
}

function matchFood(query: string): FoodEntry | null {
  let best: { item: FoodEntry; len: number } | null = null;
  for (const item of FOOD_DB) {
    for (const term of item.kw) {
      if (includesTerm(query, term) && (!best || term.length > best.len)) best = { item, len: term.length };
    }
  }
  return best?.item ?? null;
}

function toResult(item: FoodEntry, name = item.name): AiScanResult {
  return { name, calories: item.cal, protein: item.p, carbs: item.c, fats: item.f, score: item.s, advice: item.adv };
}

function recalculate(name: string): AiScanResult {
  const match = matchFood(name);
  if (match) return { ...toResult(match), name };
  const h = hashString(name.trim().toLowerCase() || 'meal');
  return {
    name,
    calories: 180 + (h % 420),
    protein: 8 + (h % 36),
    carbs: 14 + ((h >>> 3) % 48),
    fats: 4 + ((h >>> 6) % 22),
    score: Math.round((7.4 + (h % 26) / 10) * 10) / 10,
    advice: 'Estimated from the name. Use a known food, like grilled chicken or biryani, for a database match.',
  };
}

function bmiOf(kg: number, cm: number) {
  const meters = cm / 100;
  if (meters <= 0) return 0;
  return Math.round((kg / (meters * meters)) * 10) / 10;
}

function ageOf(birthday: string) {
  const born = new Date(`${birthday}T00:00:00`);
  if (Number.isNaN(born.getTime())) return 28;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const month = now.getMonth() - born.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < born.getDate())) age -= 1;
  return Math.max(1, age);
}

function nudgeHeightCm(cm: number, units: UnitSystem, dir: 1 | -1) {
  const next = units === 'imperial' ? inToCm(Math.round(cm / 2.54) + dir) : Math.round(cm) + dir;
  return Math.min(220, Math.max(120, roundTo(next, 1)));
}

/** Body weight is stored in kg. Imperial users move in whole pounds. */
function nudgeWeightKg(kg: number, units: UnitSystem, dir: 1 | -1) {
  const next = units === 'imperial' ? roundTo(lbToKg(Math.round(kgToLb(kg)) + dir), 3) : roundTo(kg + dir * 0.5, 1);
  return Math.min(180, Math.max(35, next));
}

function clockTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function sleepHours(bed: string, wake: string) {
  if (!clockTime(bed) || !clockTime(wake)) return 0;
  const [bedH, bedM] = bed.split(':').map(Number);
  const [wakeH, wakeM] = wake.split(':').map(Number);
  let minutes = wakeH * 60 + wakeM - (bedH * 60 + bedM);
  if (minutes <= 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 10) / 10;
}

function sleepStatus(hours: number) {
  if (hours >= 7 && hours <= 9) return 'Optimal';
  if (hours < 6.5) return 'Short';
  return 'Logged';
}

function fastStage(seconds: number) {
  const hours = seconds / 3600;
  if (hours >= 16) return 'Autophagy';
  if (hours >= 12) return 'Fat Burning Zone 🔥';
  if (hours >= 4) return 'Blood Sugar Drop';
  if (hours > 0) return 'Fed State';
  return 'Ready to start';
}

function keptClock(value: unknown) {
  return typeof value === 'string' && clockTime(value) ? value : '';
}

function keptEmail(email: string) {
  const trimmed = email.trim().slice(0, 80);
  if (/^alex\.rivera@huawei\.com$/i.test(trimmed)) return '';
  return trimmed;
}

function formatTime(sec: number) {
  const safe = Math.max(0, Math.floor(sec));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return [h, m, s].map((part) => String(part).padStart(2, '0')).join(':');
}

function formatDistance(km: number) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(2)} km`;
}

function trackStats(sport: string, seconds: number, weightKg: number) {
  const meta = SPORTS[sport] ?? SPORTS['Custom Workout'];
  const safe = Math.max(0, seconds);
  return {
    distanceKm: (meta.mps * safe) / 1000,
    calories: meta.met * weightKg * (safe / 3600),
  };
}

function DietBadges({ codes, label }: { codes: DietCode[]; label: (key: CopyKey) => string }) {
  if (!codes.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {codes.map((code) => {
        const warn = code === 'notHalal' || code === 'gluten' || code === 'milk' || code === 'nuts' || code === 'notVegan' || code === 'notVegetarian';
        const key: CopyKey = code === 'halal' ? 'halalOk' : code;
        const tone = warn ? 'bg-[#ffe4e6] text-[#be123c]' : code === 'halalUnknown' ? 'bg-slate-100 text-slate-600' : 'bg-[#dcfce7] text-[#047857]';
        return <span key={code} className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${tone}`}>{warn ? `⚠️ ${label(key)}` : code === 'halalUnknown' ? label(key) : `✓ ${label(key)}`}</span>;
      })}
    </div>
  );
}

const NUTRI_COLOR: Record<string, string> = { a: '#038141', b: '#85bb2f', c: '#c4a000', d: '#ee8100', e: '#e63e11' };

function tapHaptic() {
  try {
    navigator.vibrate?.(15);
  } catch {
    /* This device has no vibration API. */
  }
}

function ringLength(r: number) {
  return 2 * Math.PI * r;
}

function coachContextLine(ctx: CoachContext) {
  const bmr = Math.round(10 * ctx.weightKg + 6.25 * ctx.heightCm - 5 * ctx.age + (ctx.gender === 'Female' ? -161 : 5));
  const maintain = Math.round(bmr * 1.45);
  const cut = Math.max(1200, maintain - 500);
  const proteinGoal = Math.round(ctx.weightKg * 1.6);
  return { bmr, maintain, cut, proteinGoal, bmi: bmiOf(ctx.weightKg, ctx.heightCm) };
}

function coachSystemPrompt(ctx: CoachContext) {
  const stats = coachContextLine(ctx);
  const units = readUnits();
  const diet = readDiet();
  const today = JSON.stringify({
    kcal: ctx.calories,
    kcalGoal: CAL_GOAL,
    protein: ctx.protein,
    carbs: ctx.carbs,
    fat: ctx.fats,
    steps: ctx.steps,
    water: `${formatWater(ctx.waterL, units)}/${formatWaterGoal(units)}`,
    burned: Math.round(ctx.burned),
    sleepH: ctx.sleepHrs,
    lang: readLang(),
    diet: DIET_FLAGS.filter((flag) => diet[flag]),
    units,
  });
  return [
    'You are FitBite Pro’s coach. Direct answer only. Reply in the user’s exact language and script. Max 3 short sentences or 3 bullets.',
    `Athlete: ${ctx.name}, ${ctx.gender}, age ${ctx.age}, ${formatHeightUnits(ctx.heightCm, units)}, ${formatWeight(ctx.weightKg, units)}, BMI ${stats.bmi.toFixed(1)}.`,
    `Today: ${today}`,
    `Targets: maintenance about ${stats.maintain} kcal, a steady cut near ${stats.cut} kcal, protein about ${stats.proteinGoal} g.`,
  ].join('\n');
}

function defaultPrefs(): DeskPrefs {
  return { meals: true, water: true, watch: true, background: false, appleHealth: false, googleHealth: false, appLock: false, pin: '', vault: false };
}

function readPrefs(): DeskPrefs {
  if (typeof window === 'undefined') return defaultPrefs();
  try {
    const data = JSON.parse(window.localStorage.getItem(PREFS_KEY) || '') as Partial<DeskPrefs>;
    const base = defaultPrefs();
    (Object.keys(base) as (keyof DeskPrefs)[]).forEach((key) => {
      if (typeof data[key] === typeof base[key]) (base[key] as DeskPrefs[keyof DeskPrefs]) = data[key] as DeskPrefs[keyof DeskPrefs];
    });
    if (typeof data.pin === 'string') base.pin = data.pin.slice(0, 80);
    return base;
  } catch {
    return defaultPrefs();
  }
}

async function pinDigest(pin: string) {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`fitbite:${pin}`));
  return [...new Uint8Array(data)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function localCoachFromPrompt(prompt: string) {
  const user = (prompt.split('User:').pop() || '').trim();
  if (readLang() === 'ar') return 'ركّز اليوم على إكمال البروتين وشرب الماء وإبقاء السعرات ضمن هدفك. ليسدّ طعامك القادم أكبر فجوة.';
  if (/[\u0600-\u06FF]/.test(user)) return 'آج پروٹین پورا کریں، پانی پئیں، اور کیلوریز ہدف کے اندر رکھیں۔ اگلا کھانا سب سے بڑے فرق کو بند کرے۔';
  if (/\b(kya|kaise|karun|karo|hai|nahi|mujhe|mera)\b/i.test(user)) return 'Seedha jawab: protein complete karo, pani pio, aur calories goal ke andar rakho. Agla meal sab se bari kami pur kare.';
  if (/water|hydrat/i.test(user)) return `Drink toward ${formatWaterGoal(readUnits())}. One glass now if you are still under the line.`;
  if (/protein/i.test(user)) return 'Close the protein gap with one lean serving. The target is already on your profile.';
  if (/workout|run|gym|bench|squat/i.test(user)) return 'Do the session you planned. Stop with one rep left in reserve.';
  return 'Stay with today’s targets. Calories, protein, and water are the three numbers that matter. Let the next meal close the biggest gap.';
}

/** Resizes to at most 768 px on an offscreen canvas and exports a compressed JPEG (about 60 to 150 KB). */
function jpegBase64(source: CanvasImageSource, width: number, height: number) {
  const max = 768;
  const scale = Math.min(1, max / Math.max(width, height, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The photo could not be prepared. Try another one.');
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  let data = (canvas.toDataURL('image/jpeg', 0.72).split(',')[1] ?? '').trim();
  if (data.length > 200000) data = (canvas.toDataURL('image/jpeg', 0.6).split(',')[1] ?? '').trim();
  if (data.length < 32) throw new Error('The photo was empty. Take another one.');
  return data;
}

function imageElementToJpeg(file: File) {
  return new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const data = jpegBase64(img, img.naturalWidth, img.naturalHeight);
        URL.revokeObjectURL(url);
        resolve(data);
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error instanceof Error ? error : new Error('The photo was empty. Take another one.'));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The photo could not be read. Try another one.'));
    };
    img.src = url;
  });
}

/** Decodes off the main thread when the browser can, then shrinks. Older WebViews use an image element. */
async function fileToJpeg(file: File) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      try {
        return jpegBase64(bitmap, bitmap.width, bitmap.height);
      } finally {
        bitmap.close();
      }
    } catch {
      /* The image element path below reads the same file. */
    }
  }
  return imageElementToJpeg(file);
}

function scanPrompt(note: string, extra: string) {
  return [
    'Identify one serving of the food. Compact JSON only, no markdown.',
    extra,
    note.trim() ? `User note: ${note.trim()}` : '',
    'name and verdict use the note’s language. Keys stay English.',
    'halal is true only when the food is verified halal, otherwise false. contains lists visible allergen words (gluten, milk, nuts, pork) or [].',
    'score is health 1 to 10. verdict is at most 10 words.',
    '{"name":"","servingG":0,"score":7,"calories":0,"protein":0,"carbs":0,"fat":0,"halal":false,"contains":[],"verdict":""}',
  ].filter(Boolean).join('\n');
}

async function readBarcode(source: CanvasImageSource) {
  const Detector = (window as Window & { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (image: CanvasImageSource) => Promise<{ rawValue?: string }[]> } }).BarcodeDetector;
  if (!Detector) return '';
  try {
    const detector = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] });
    const codes = await detector.detect(source);
    return (codes[0]?.rawValue ?? '').replace(/\s/g, '');
  } catch {
    return '';
  }
}

async function askGeminiScan(prompt: string, jpeg: string | undefined, signal?: AbortSignal) {
  if (jpeg) {
    const outcome = await analyzeFoodPhoto(prompt, jpeg, signal);
    if ('error' in outcome) throw new Error(outcome.error);
    return outcome.card;
  }
  const text = await askNeural(prompt, undefined, 450, 0.2, 30000, signal);
  if (!text) throw new Error('The scan didn’t finish. Tap the photo again to retry.');
  try {
    return { ...parseScanNutrition(text), model: readEngineRoute() };
  } catch {
    throw new Error('The scan didn’t return nutrition. Tap the photo again to retry.');
  }
}

function dietSignature() {
  const diet = readDiet();
  return DIET_FLAGS.filter((flag) => diet[flag]).join(',');
}

/** A quick-chip answer stays valid while the day's numbers sit in the same coarse buckets. */
function coachChipKey(preset: string, ctx: CoachContext) {
  return ttlKey('coach', [preset, readLang(), readUnits(), dietSignature(), Math.round(ctx.calories / 150), Math.round(ctx.protein / 15), Math.round(ctx.waterL * 2), Math.round(ctx.steps / 2500)]);
}

function recipeCacheKey(names: string[], craving: string) {
  return ttlKey('kitchen', [[...names].map((name) => name.trim().toLowerCase()).sort().join(','), craving, readLang(), readUnits(), dietSignature()]);
}

type StreamedRecipe = { title: string; cal: number; protein: number; carbs: number; fats: number; steps: string[]; halal: boolean };

async function askGeminiRecipe(names: string[], craving = '', signal?: AbortSignal, onPartial?: (recipe: StreamedRecipe) => void) {
  const prompt = [
    `One short recipe using only these ingredients: ${names.join(', ')}.`,
    craving ? `Style: ${craving}. Keep it gentle everyday food, not a medical plan.` : 'Keep it gentle everyday food.',
    'Reply as plain text, exactly these lines and nothing else:',
    'TITLE: recipe name',
    'MACROS: N kcal | P N | C N | F N | HALAL yes or no',
    'Replace every N with your own estimate in grams (calories in kcal) for one serving. Never copy example numbers.',
    '1. step of at most 12 words',
    '2. step of at most 12 words',
    'Use 2 to 4 numbered steps.',
  ].join('\n');
  const text = await streamNeural({
    kind: 'kitchen',
    system: '',
    prompt,
    tokens: 450,
    temperature: 0.3,
    signal,
    cacheKey: recipeCacheKey(names, craving),
    onText: (partial) => {
      const card = recipeFromStream(partial);
      if (card) onPartial?.({ ...card, halal: card.halal === true });
    },
  });
  if (text) {
    const recipe = recipeFromStream(text);
    if (recipe && recipe.cal > 0 && recipe.steps.length > 0) return { ...recipe, halal: recipe.halal === true, live: true as const };
  }
  const local = cookFromFridge(names);
  return { ...local, steps: local.steps.slice(0, 4), halal: false, live: false as const };
}

function DeskIcon({ name }: { name: 'cloud' | 'user' | 'bell' | 'activity' | 'shield' | 'message' | 'download' | 'info' }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      {name === 'cloud' && <path d="M7 18h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.5A3.5 3.5 0 0 0 7 18z" {...common} />}
      {name === 'user' && (<><circle cx="12" cy="8" r="3" {...common} /><path d="M5.5 19c1.4-2.6 3.4-3.8 6.5-3.8s5.1 1.2 6.5 3.8" {...common} /></>)}
      {name === 'bell' && <path d="M6 9a6 6 0 0 1 12 0c0 5 1.5 6.5 1.5 6.5H4.5S6 14 6 9zM10 18a2 2 0 0 0 4 0" {...common} />}
      {name === 'activity' && <path d="M3 12h4l2.5-6 4 12L16 12h5" {...common} />}
      {name === 'shield' && <path d="M12 3l7 3v6c0 4.5-2.8 7.2-7 9-4.2-1.8-7-4.5-7-9V6l7-3zM9 12l2 2 4-4" {...common} />}
      {name === 'message' && <path d="M5 6h14v9H8l-3 3V6z" {...common} />}
      {name === 'download' && <path d="M12 4v10m0 0l-4-4m4 4l4-4M5 19h14" {...common} />}
      {name === 'info' && (<><circle cx="12" cy="12" r="8" {...common} /><path d="M12 11v5M12 8h.01" {...common} /></>)}
    </svg>
  );
}

function Icon({ name, className = 'h-5 w-5' }: { name: 'today' | 'health' | 'ai' | 'sport' | 'me' | 'flame' | 'water'; className?: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {name === 'today' && <circle cx="12" cy="12" r="4" {...common} />}
      {name === 'today' && (
        <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19" {...common} />
      )}
      {name === 'health' && <path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z" {...common} />}
      {name === 'ai' && <path d="M12 3l1.2 4.2L17.5 8.5 13.2 9.8 12 14l-1.2-4.2L6.5 8.5l4.3-1.3L12 3zM18 14l.6 2 2 .6-2 .6-.6 2-.6-2-2-.6 2-.6.6-2z" {...common} />}
      {name === 'sport' && <path d="M4 15c2.2-3 4-7 8-7s5.2 2.2 8 7M8 19c1.2-2 2.4-3 4-3s2.8 1 4 3" {...common} />}
      {name === 'me' && (
        <>
          <circle cx="12" cy="8" r="3.2" {...common} />
          <path d="M5 19.2c1.4-3 3.5-4.4 7-4.4s5.6 1.4 7 4.4" {...common} />
        </>
      )}
      {name === 'flame' && <path d="M12 3s4 3.2 4 7a4 4 0 1 1-8 0c0-1.2.6-2.2 1.2-3C8.2 8.2 7 10 7 12.2 7 16 9.2 19 12 21c2.8-2 5-5 5-8.8C17 7.2 12 3 12 3z" {...common} />}
      {name === 'water' && <path d="M12 3s6 6.2 6 10.2A6 6 0 0 1 6 13.2C6 9.2 12 3 12 3z" {...common} />}
    </svg>
  );
}

function ActivityRings({ calories, steps, water, waterGoal, draw, night = false }: { calories: number; steps: number; water: number; waterGoal: number; draw: boolean; night?: boolean }) {
  const stroke = 12;
  const rings = [
    { id: 'cal', r: 76, pct: calories / CAL_GOAL, track: night ? 'rgba(255,45,85,0.18)' : '#ffe3ea', from: '#ff7a93', to: '#ff2d55', label: 'Calories' },
    { id: 'step', r: 58, pct: steps / STEP_GOAL, track: night ? 'rgba(34,197,94,0.16)' : '#ddf8e6', from: '#62e08c', to: '#22c55e', label: 'Steps' },
    { id: 'water', r: 40, pct: water / waterGoal, track: night ? 'rgba(14,165,233,0.18)' : '#dff4ff', from: '#7dd7ff', to: '#0ea5e9', label: 'Water' },
  ];
  return (
    <svg viewBox="0 0 200 200" className="h-[228px] w-[228px]" aria-hidden="true">
      <defs>
        {rings.map((ring) => (
          <linearGradient key={ring.id} id={`ring-${ring.id}`} gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={ring.from} />
            <stop offset="100%" stopColor={ring.to} />
          </linearGradient>
        ))}
      </defs>
      <g transform="rotate(-90 100 100)" fill="none">
        {rings.map((ring) => {
          const c = ringLength(ring.r);
          const pct = draw ? Math.max(0, Math.min(0.96, ring.pct)) : 0;
          return (
            <g key={ring.label}>
              <circle cx="100" cy="100" r={ring.r} stroke={ring.track} strokeWidth={stroke} />
              <circle
                className="ring-stroke"
                cx="100"
                cy="100"
                r={ring.r}
                stroke={`url(#ring-${ring.id})`}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${c} ${c}`}
                strokeDashoffset={c * (1 - pct)}
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function openSpotifyApp() {
  const fallback = window.setTimeout(() => {
    if (document.visibilityState === 'visible') window.open('https://open.spotify.com', '_blank', 'noopener,noreferrer');
  }, 900);
  const cancel = () => window.clearTimeout(fallback);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') cancel();
  }, { once: true });
  window.location.href = 'spotify://';
}

function nativeMusic() {
  return (window as Window & { FitBiteNative?: { openPhoneMusicApp?: () => void; pickAudioTrack?: () => void } }).FitBiteNative;
}

function MusicHub() {
  const phoneAudio = useRef<HTMLAudioElement | null>(null);
  const [track, setTrack] = useState<{ name: string; url: string } | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const onPick = (name: string, path: string) => {
      const url = /^(https?:|blob:|data:|capacitor:)/.test(path) ? path : Capacitor.convertFileSrc(path);
      setTrack({ name: name || 'Selected track', url });
      const audio = phoneAudio.current ?? new Audio();
      phoneAudio.current = audio;
      audio.src = url;
      audio.onended = () => setPlaying(false);
      void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    };
    (window as Window & { fitbiteOnAudioPicked?: (name: string, path: string) => void }).fitbiteOnAudioPicked = onPick;
    return () => {
      phoneAudio.current?.pause();
      delete (window as Window & { fitbiteOnAudioPicked?: (name: string, path: string) => void }).fitbiteOnAudioPicked;
    };
  }, []);

  return (
    <div className="card mt-4 flex items-center gap-2 p-2">
      <button type="button" className="shrink-0 rounded-full bg-slate-900 px-3 py-2 text-[11px] font-extrabold on-gradient" onClick={() => nativeMusic()?.openPhoneMusicApp?.()}>Phone Music</button>
      <button type="button" className="shrink-0 rounded-full bg-slate-100 px-3 py-2 text-[11px] font-extrabold text-slate-700" onClick={() => nativeMusic()?.pickAudioTrack?.()}>Pick Track</button>
      <button type="button" className="shrink-0 rounded-full bg-slate-100 px-3 py-2 text-[11px] font-extrabold text-slate-700" onClick={openSpotifyApp}>Spotify</button>
      <button
        type="button"
        className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-black on-gradient disabled:opacity-40"
        aria-label={playing ? 'Pause phone music' : 'Play phone music'}
        disabled={!track}
        onClick={() => {
          const audio = phoneAudio.current;
          if (!audio || !track) return;
          if (playing) {
            audio.pause();
            setPlaying(false);
          } else {
            void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
          }
        }}
      >
        {playing ? '❚❚' : '▶'}
      </button>
    </div>
  );
}

function WatchFace({ kind, bpm, alert, compact = false, live = true }: { kind: WatchId | 'custom'; bpm: number | null; alert: string | null; compact?: boolean; live?: boolean }) {
  return (
    <div className={`relative grid shrink-0 place-items-center overflow-hidden ${compact ? 'h-16 w-16' : 'h-[132px] w-[132px]'}`}>
      {kind === 'apple' && (
        <svg viewBox="0 0 120 120" className="h-full w-full">
          <rect x="52" y="6" width="16" height="14" rx="4" fill="#2a2a2e" />
          <rect x="52" y="100" width="16" height="14" rx="4" fill="#2a2a2e" />
          <circle cx="60" cy="60" r="46" fill="#1b2438" stroke="#ff375f" strokeWidth="6" />
          <circle cx="60" cy="60" r="34" fill="#0d1424" stroke="rgba(255,255,255,0.12)" />
          <path d="M60 36v24l14 8" fill="none" stroke="#ff9f0a" strokeWidth="3" strokeLinecap="round" />
          <circle cx="60" cy="60" r="3" fill="#ffd60a" />
        </svg>
      )}
      {kind === 'samsung' && (
        <svg viewBox="0 0 120 120" className="h-full w-full">
          <rect x="8" y="40" width="104" height="40" rx="14" fill="#111114" stroke="#38bdf8" strokeWidth="4" />
          <rect x="18" y="48" width="68" height="24" rx="8" fill="#0b1220" />
          <text x="52" y="64" textAnchor="middle" fill="#f8fafc" fontSize="11" fontFamily="inherit">{live && bpm !== null ? bpm : '--'}</text>
          <rect x="92" y="52" width="10" height="16" rx="3" fill="#22c55e" />
          <rect x="4" y="50" width="6" height="20" rx="2" fill="#64748b" />
        </svg>
      )}
      {kind === 'custom' && (
        <svg viewBox="0 0 120 120" className="h-full w-full">
          <circle cx="60" cy="60" r="46" fill="#111827" stroke="#38bdf8" strokeWidth="5" />
          <circle cx="60" cy="60" r="28" fill="none" stroke="#a78bfa" strokeWidth="3" />
          <path d="M48 62l8 8 16-18" fill="none" stroke="#22c55e" strokeWidth="4" strokeLinecap="round" />
        </svg>
      )}
      {kind === 'huawei' && (
        <svg viewBox="0 0 120 120" className="h-full w-full">
          <rect x="34" y="10" width="52" height="100" rx="16" fill="#14110c" stroke="#e6c27a" strokeWidth="4" />
          <rect x="40" y="22" width="40" height="62" rx="8" fill="#07140f" />
          <text x="60" y="58" textAnchor="middle" fill="#f5f5f7" fontSize="13" fontFamily="inherit">{live && bpm !== null ? bpm : '--'}</text>
        </svg>
      )}
      {kind !== 'huawei' && kind !== 'samsung' && (
        <div className="on-gradient absolute text-center">
          <div className="text-[18px] font-black tabular-nums leading-none">{live && bpm !== null ? bpm : '--'}</div>
          <div className="text-[8px] font-bold tracking-[0.14em] opacity-70">BPM</div>
        </div>
      )}
      {alert && <span className="absolute top-[22%] right-[28%] h-2.5 w-2.5 rounded-full bg-[#ff375f] ring-2 ring-white" />}
    </div>
  );
}

type WebSpeech = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results?: ArrayLike<{ 0?: { transcript?: string } }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

export default function Home() {
  const [store, setStore] = useState<Store>(defaultStore);
  const [hydrated, setHydrated] = useState(false);
  const [welcomeSlide, setWelcomeSlide] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>('today');
  const [aiTab, setAiTab] = useState<AiTab>('coach');
  const [scanMode, setScanMode] = useState<ScanMode>('photo');
  const [scanBusy, setScanBusy] = useState(false);
  const [scanNote, setScanNote] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scanResult, setScanResult] = useState<ScanNutrition | null>(null);
  const [scanNotice, setScanNotice] = useState('');
  const [scanPreview, setScanPreview] = useState<string | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallReason, setPaywallReason] = useState<PaywallReason>(null);
  const [legal, setLegal] = useState<LegalKind | null>(null);
  const [units, setUnits] = useState<UnitSystem>('metric');
  const [quotaTick, setQuotaTick] = useState(0);
  const [craving, setCraving] = useState('');
  const [packed, setPacked] = useState<number[]>([]);
  const [scanStage, setScanStage] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [customWatchName, setCustomWatchName] = useState('');
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  const [voiceFor, setVoiceFor] = useState<VoiceTarget | null>(null);
  const [voiceNote, setVoiceNote] = useState('');
  const [prefs, setPrefs] = useState<DeskPrefs>(defaultPrefs);
  const [unlocked, setUnlocked] = useState(false);
  const [desk, setDesk] = useState<keyof DeskPrefs | 'account' | 'body' | 'alerts' | 'sensor' | 'privacy' | 'feedback' | 'update' | 'about' | null>(null);
  const [pinDraft, setPinDraft] = useState('');
  const [feedback, setFeedback] = useState('');
  const [rating, setRating] = useState(5);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [updateNote] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [lang, setLang] = useState<Lang>('en');
  const [diet, setDiet] = useState<DietPrefs>(emptyDiet());
  const [aiConsent, setAiConsent] = useState(true);
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [offCard, setOffCard] = useState<OffProduct | null>(null);
  const [offNote, setOffNote] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [showMealLog, setShowMealLog] = useState(false);
  const [foodQuery, setFoodQuery] = useState('');
  const [aiResult, setAiResult] = useState<AiScanResult | null>(null);
  const [coachBusy, setCoachBusy] = useState(false);
  const [recipeBusy, setRecipeBusy] = useState(false);
  const [coachLive, setCoachLive] = useState<{ id: number; text: string } | null>(null);
  const [ingredient, setIngredient] = useState('');
  const [recipe, setRecipe] = useState<KitchenRecipe | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [challenge, setChallenge] = useState<SavedChallenge | null>(null);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [selectedSport, setSelectedSport] = useState<string | null>(null);
  const [showGps, setShowGps] = useState(false);
  const [bleState, setBleState] = useState('idle');
  const [bleDevices, setBleDevices] = useState<BleDevice[]>([]);
  const [bleLink, setBleLink] = useState<BleLink | null>(null);
  const [lastWatch, setLastWatch] = useState<{ mac: string; name: string } | null>(null);
  const [workoutOn, setWorkoutOn] = useState(false);
  const [workoutSec, setWorkoutSec] = useState(0);
  const [gpsLabel, setGpsLabel] = useState('GPS route active');
  const [heartRate, setHeartRate] = useState<number | null>(null);
  const [hrvMs, setHrvMs] = useState<number | null>(null);
  const [bpmSamples, setBpmSamples] = useState<number[]>([]);
  const [sleepOpen, setSleepOpen] = useState(false);
  const [sleepDraftBed, setSleepDraftBed] = useState('23:00');
  const [sleepDraftWake, setSleepDraftWake] = useState('07:00');
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [drawRings, setDrawRings] = useState(false);
  const [waterPulse, setWaterPulse] = useState(0);
  const [liftName, setLiftName] = useState<LiftName>('Bench Press');
  const [liftWeight, setLiftWeight] = useState('80');
  const [liftReps, setLiftReps] = useState('5');
  const [plateCursor, setPlateCursor] = useState(0);
  const [fuelLive, setFuelLive] = useState<{ key: string; pre: FuelPlate; post: FuelPlate } | null>(null);
  const [fuelBusy, setFuelBusy] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bleHandler = useRef<(event: BleEvent) => void>(() => undefined);
  const pairedMac = useRef('');
  const rrWindow = useRef<number[]>([]);
  const storeRef = useRef<Store>(defaultStore());
  const savedRaw = useRef('');
  const idRef = useRef(0);
  const mounted = useRef(true);
  const chatRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const scanLock = useRef(false);
  const coachAbort = useRef<AbortController | null>(null);
  const coachCancel = useRef<'clear' | 'leave' | null>(null);
  const kitchenAbort = useRef<AbortController | null>(null);
  const scanAbort = useRef<AbortController | null>(null);
  const voiceStop = useRef<(() => void) | null>(null);
  const vaultOn = useRef(false);
  const preserveStore = useRef(false);

  const nextId = () => {
    idRef.current += 1;
    return Date.now() + idRef.current;
  };

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  };

  const reportAi = (kind: string, detail: string) => {
    try {
      const key = 'fitbite_ai_reports_v1';
      const rows = JSON.parse(window.localStorage.getItem(key) || '[]') as { kind: string; detail: string; at: string }[];
      rows.unshift({ kind, detail: detail.slice(0, 180), at: new Date().toISOString() });
      window.localStorage.setItem(key, JSON.stringify(rows.slice(0, 30)));
    } catch {
      /* The toast still confirms the tap. */
    }
    showToast('Flagged for review — thank you');
  };

  const eraseLocalAccount = () => {
    nativeBle()?.stopScan?.();
    nativeBle()?.disconnectWatch?.();
    preserveStore.current = true;
    for (const key of [STORAGE_KEY, LEGACY_KEY, PREFS_KEY, VAULT_KEY, CHALLENGE_KEY, QUOTA_STORAGE_KEY, DIET_KEY, LANG_KEY, UNITS_KEY, AI_CONSENT_KEY, OFF_CACHE_KEY, AI_TTL_KEY, LAST_WATCH_KEY, SUBSCRIPTION_KEY, 'fitbite_ai_cache_v1', 'fitbite_ai_reports_v1']) {
      window.localStorage.removeItem(key);
    }
    try {
      // Every remaining key, including chat logs, the AI cache, and pairing records, goes with the account.
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      /* The keys above are already gone. */
    }
    window.location.reload();
  };

  const backState = useRef({
    showPaywall: false,
    legal: null as LegalKind | null,
    desk: null as typeof desk,
    scanOpen: false,
    showGps: false,
    sleepOpen: false,
    showMealLog: false,
    showDeleteConfirm: false,
    barcodeOpen: false,
    flowStep: store.flowStep,
    activeTab,
  });
  backState.current = { showPaywall, legal, desk, scanOpen, showGps, sleepOpen, showMealLog, showDeleteConfirm, barcodeOpen, flowStep: store.flowStep, activeTab };

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = App.addListener('backButton', () => {
      const snap = backState.current;
      if (snap.barcodeOpen) { setBarcodeOpen(false); return; }
      if (snap.showDeleteConfirm) { setShowDeleteConfirm(false); return; }
      if (snap.legal) { setLegal(null); return; }
      if (snap.showPaywall) { setShowPaywall(false); return; }
      if (snap.desk) { setDesk(null); return; }
      if (snap.scanOpen) { setScanOpen(false); return; }
      if (snap.showGps) { setShowGps(false); return; }
      if (snap.sleepOpen) { setSleepOpen(false); return; }
      if (snap.showMealLog) { setShowMealLog(false); return; }
      if (snap.flowStep !== 'app') { setStore((current) => ({ ...current, flowStep: 'app' })); return; }
      if (snap.activeTab !== 'today') { setActiveTab('today'); return; }
      void App.exitApp();
    });
    return () => { void handle.then((listener) => listener.remove()); };
  }, []);

  useEffect(() => {
    setLang(readLang());
    const savedUnits = readUnits();
    setUnits(savedUnits);
    if (savedUnits === 'imperial') setLiftWeight('175');
    setDiet(readDiet());
    setAiConsent(readAiConsent());
    setLastWatch(readLastWatch());
  }, []);

  useEffect(() => {
    const bridge = window as Window & { fitbiteBle?: (json: string) => void };
    bridge.fitbiteBle = (json: string) => {
      try {
        bleHandler.current(JSON.parse(json) as BleEvent);
      } catch {
        /* Ignore malformed native events. */
      }
    };
    return () => {
      delete bridge.fitbiteBle;
    };
  }, []);

  useEffect(() => {
    applyDocumentLanguage(lang);
  }, [lang]);

  useEffect(() => {
    void refreshSubscription().then((subscription) => {
      if (subscription) setStore((s) => (s.proActive === subscription.isPro ? s : { ...s, proActive: subscription.isPro }));
    });
  }, []);

  useEffect(() => {
    if (scanOpen) return;
    nativeBle()?.stopScan?.();
    setBleState((state) => (state === 'scanning' ? 'idle' : state));
  }, [scanOpen]);

  useEffect(() => {
    mounted.current = true;
    const nextPrefs = readPrefs();
    setPrefs(nextPrefs);
    vaultOn.current = nextPrefs.vault;
    void (async () => {
      try {
        const text = await readStoredText();
        if (text) {
          const saved = sanitize(JSON.parse(text) as unknown);
          if (saved) {
            savedRaw.current = JSON.stringify(saved);
            setStore(saved);
          }
        }
      } catch {
        preserveStore.current = true;
      }
      if (mounted.current) setHydrated(true);
    })();
    return () => {
      mounted.current = false;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!hydrated || preserveStore.current) return;
    const raw = JSON.stringify(store);
    const vaultChanged = vaultOn.current !== prefs.vault;
    if (raw === savedRaw.current && !vaultChanged) return;
    savedRaw.current = raw;
    vaultOn.current = prefs.vault;
    void writeStore(raw, prefs.vault).catch(() => {
      /* Keep the previous copy if the vault write fails. */
    });
  }, [hydrated, store, prefs.vault]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }, [hydrated, prefs]);

  useEffect(() => {
    if (!hydrated || store.flowStep !== 'app' || activeTab !== 'today') return;
    setDrawRings(false);
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setDrawRings(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [hydrated, store.flowStep, activeTab]);

  useEffect(() => {
    if (!workoutOn && !store.isFasting) return;
    const id = window.setInterval(() => {
      if (workoutOn) setWorkoutSec((sec) => sec + 1);
      if (store.isFasting) setNowTick(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [workoutOn, store.isFasting]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [store.chat, aiTab, coachLive]);

  // Leaving a feature cancels its running request, so a stale answer never lands on a screen that moved on.
  useEffect(() => {
    if (activeTab !== 'ai' || aiTab !== 'coach') {
      coachCancel.current = 'leave';
      coachAbort.current?.abort();
    }
    if (activeTab !== 'ai' || aiTab !== 'kitchen') kitchenAbort.current?.abort();
    if (activeTab !== 'ai' || aiTab !== 'scan') scanAbort.current?.abort();
    if (activeTab === 'ai') warmAiServer();
  }, [activeTab, aiTab]);

  useEffect(() => () => {
    voiceStop.current?.();
    voiceStop.current = null;
  }, []);

  const endVoice = () => {
    const stop = voiceStop.current;
    voiceStop.current = null;
    stop?.();
    setVoicePhase('idle');
  };

  const denyMic = (target: VoiceTarget) => {
    setVoiceFor(target);
    setVoicePhase('idle');
    setVoiceNote('Microphone permission was denied. Allow the mic to dictate.');
  };

  const dictate = (target: VoiceTarget, apply: (text: string) => void) => {
    if (voicePhase !== 'idle') {
      endVoice();
      return;
    }
    setVoiceNote('');
    setVoiceFor(target);
    void startDictation(target, apply);
  };

  const startDictation = async (target: VoiceTarget, apply: (text: string) => void) => {
    const android = Capacitor.getPlatform() === 'android';
    const SpeechCtor = (window as Window & { SpeechRecognition?: new () => WebSpeech; webkitSpeechRecognition?: new () => WebSpeech }).SpeechRecognition
      || (window as Window & { webkitSpeechRecognition?: new () => WebSpeech }).webkitSpeechRecognition;
    if (android) {
      if (SpeechCtor && listenWeb(target, apply, SpeechCtor, true)) return;
      await listenRecorder(target, apply);
      return;
    }
    if (Capacitor.isNativePlatform()) {
      try {
        const permission = await SpeechRecognition.requestPermissions();
        if (permission.speechRecognition === 'denied') {
          denyMic(target);
          return;
        }
        const ready = await SpeechRecognition.available();
        if (ready.available) {
          await listenNative(target, apply);
          return;
        }
      } catch {
        /* The recorder covers a device without a speech service. */
      }
    }
    if (SpeechCtor && listenWeb(target, apply, SpeechCtor, false)) return;
    await listenRecorder(target, apply);
  };

  const listenNative = async (target: VoiceTarget, apply: (text: string) => void) => {
    await SpeechRecognition.removeAllListeners();
    await SpeechRecognition.addListener('partialResults', (data) => {
      const said = data.matches?.[0]?.trim() ?? '';
      if (said) apply(said);
    });
    await SpeechRecognition.addListener('listeningState', (data) => {
      if (data.status === 'stopped') {
        voiceStop.current = null;
        void SpeechRecognition.removeAllListeners().catch(() => undefined);
        setVoicePhase('idle');
      }
    });
    voiceStop.current = () => {
      void SpeechRecognition.stop().catch(() => undefined);
    };
    setVoiceFor(target);
    setVoicePhase('listening');
    try {
      const result = await SpeechRecognition.start({ language: speechLanguage(), partialResults: true, popup: false, maxResults: 1 });
      const said = result.matches?.[0]?.trim() ?? '';
      if (said) apply(said);
      const listening = await SpeechRecognition.isListening().catch(() => ({ listening: false }));
      if (!listening.listening) {
        voiceStop.current = null;
        void SpeechRecognition.removeAllListeners().catch(() => undefined);
        setVoicePhase('idle');
      }
    } catch {
      voiceStop.current = null;
      await SpeechRecognition.removeAllListeners().catch(() => undefined);
      await listenRecorder(target, apply);
    }
  };

  const listenWeb = (target: VoiceTarget, apply: (text: string) => void, SpeechCtor: new () => WebSpeech, handoff: boolean) => {
    const rec = new SpeechCtor();
    let handedOff = false;
    const passToRecorder = () => {
      if (handedOff) return;
      handedOff = true;
      void listenRecorder(target, apply);
    };
    rec.lang = speechLanguage();
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (event) => {
      const list = event.results;
      const last = list && list.length ? list[list.length - 1]?.[0]?.transcript?.trim() ?? '' : '';
      if (last) apply(last);
    };
    rec.onerror = (event) => {
      const denied = event.error === 'not-allowed' || event.error === 'service-not-allowed';
      if (denied && !handoff) {
        denyMic(target);
        return;
      }
      passToRecorder();
    };
    rec.onend = () => {
      if (!handedOff) setVoicePhase('idle');
    };
    voiceStop.current = () => rec.stop();
    setVoiceFor(target);
    setVoicePhase('listening');
    try {
      rec.start();
      return true;
    } catch {
      voiceStop.current = null;
      return false;
    }
  };

  const listenRecorder = async (target: VoiceTarget, apply: (text: string) => void) => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceFor(target);
      setVoicePhase('idle');
      setVoiceNote('Voice input is not available on this device.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      denyMic(target);
      return;
    }
    const mime = audioMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    voiceStop.current = () => {
      if (recorder.state !== 'inactive') recorder.stop();
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      voiceStop.current = null;
      const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' });
      setVoicePhase('idle');
      setVoiceNote('Transcribing...');
      void (async () => {
        try {
          const audio = await blobToBase64(blob);
          if (!readAiConsent()) {
            setVoiceNote(translate(readLang(), 'consentNeed'));
            return;
          }
          const said = (await transcribeSpeech(audio, blob.type || 'audio/webm')).trim();
          if (said) {
            apply(said);
            setVoiceNote('');
          } else setVoiceNote('That clip had no recognizable speech.');
        } catch {
          setVoiceNote('That clip had no recognizable speech.');
        }
      })();
    };
    setVoiceFor(target);
    setVoicePhase('recording');
    recorder.start(250);
  };

  const patch = (partial: Partial<Store>) => setStore((s) => ({ ...s, ...partial }));

  useEffect(() => {
    if (!hydrated) return;
    const date = todayKey();
    const saved = readSavedChallenge(date);
    if (saved) {
      setChallenge(saved);
      return;
    }
    const seed = challengeSeed(date, 0);
    const first: SavedChallenge = { ...localWellnessChallenge(seed), date, completed: false, swaps: 0, streakApplied: false };
    setChallenge(first);
    writeSavedChallenge(first);
    let cancel = false;
    if (canSpend('challenge', isProPlan(store.proActive))) {
      void suggestDailyChallenge({ waterL: store.waterL, meals: store.meals.length, workouts: store.workouts.length, seed, language: aiLanguageName(readLang()), diet: dietRuleLine(readDiet()) }).then((next) => {
        if (cancel) return;
        if (lastAiWasBillable()) {
          spendQuota('challenge', isProPlan(store.proActive));
          setQuotaTick((tick) => tick + 1);
        }
        setChallenge((current) => {
          if (!current || current.date !== date || current.completed || current.swaps > 0) return current;
          const merged = { ...current, ...next };
          writeSavedChallenge(merged);
          return merged;
        });
      });
    }
    return () => { cancel = true; };
  }, [hydrated]);

  const swapChallenge = () => {
    if (!challenge || challenge.completed || challenge.swaps >= 2) return;
    const swaps = challenge.swaps + 1;
    const seed = challengeSeed(challenge.date, swaps);
    const immediate: SavedChallenge = { ...challenge, ...localWellnessChallenge(seed), swaps };
    setChallenge(immediate);
    writeSavedChallenge(immediate);
    const previousTitle = challenge.title;
    if (!canSpend('challenge', isProPlan(store.proActive))) return;
    void suggestDailyChallenge({ waterL: store.waterL, meals: store.meals.length, workouts: store.workouts.length, seed, language: aiLanguageName(readLang()), diet: dietRuleLine(readDiet()) }).then((next) => {
      if (lastAiWasBillable() && next.title.toLowerCase() !== previousTitle.toLowerCase()) {
        spendQuota('challenge', isProPlan(store.proActive));
        setQuotaTick((tick) => tick + 1);
      }
      setChallenge((current) => {
        if (!current || current.date !== immediate.date || current.swaps !== swaps || current.completed) return current;
        const fresh = next.title.toLowerCase() === previousTitle.toLowerCase() ? immediate : { ...current, ...next, swaps };
        writeSavedChallenge(fresh);
        return fresh;
      });
    });
  };

  const completeChallenge = () => {
    if (!challenge || challenge.completed) return;
    const nextStreak = Math.min(999, store.streak + (challenge.streakApplied ? 0 : 1));
    const done: SavedChallenge = { ...challenge, completed: true, streakApplied: true };
    setChallenge(done);
    writeSavedChallenge(done);
    if (!challenge.streakApplied) patch({ streak: nextStreak });
    tapHaptic();
    showToast(`Challenge complete · ${nextStreak} day streak`);
  };

  const continueWith = (provider: AuthProvider) => {
    setStore((s) => ({
      ...s,
      authProvider: provider,
      session: { provider, name: s.userName, email: keptEmail(s.userEmail), signedInAt: new Date().toISOString() },
      flowStep: s.profileComplete ? 'app' : 'profile',
    }));
    showToast(`Signed in with ${PROVIDERS[provider].label}`);
  };

  const finishProfile = () => {
    if (!emailOk(store.userEmail)) {
      showToast('Enter a valid email');
      return;
    }
    setStore((s) => ({ ...s, userEmail: s.userEmail.trim(), profileComplete: true, flowStep: s.profileComplete ? 'app' : 'device' }));
  };

  const onEditName = (name: string) => {
    setFoodQuery(name);
    setAiResult(name.trim() ? recalculate(name) : null);
  };

  const logMeal = (item: AiScanResult) => {
    const name = item.name.trim();
    if (!name) return;
    const meal: MealItem = {
      id: nextId(),
      name,
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fats: item.fats,
      time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    };
    setStore((s) => {
      if (s.meals.some((existing) => existing.id === meal.id)) return s;
      const meals = [meal, ...s.meals];
      return { ...s, meals, ...nutritionFromMeals(meals) };
    });
    setAiResult(null);
    setFoodQuery('');
    setShowMealLog(false);
    tapHaptic();
    showToast(`Logged ${meal.name} · +${meal.calories} kcal`);
  };

  const eaten = nutritionFromMeals(store.meals);
  const coachContext = (): CoachContext => ({
    name: store.userName,
    gender: store.gender,
    weightKg: store.weightKg,
    heightCm: store.heightCm,
    age: ageOf(store.birthday),
    calories: eaten.calories,
    protein: eaten.protein,
    carbs: eaten.carbs,
    fats: eaten.fats,
    steps: store.steps,
    waterL: store.waterL,
    burned: store.activeBurn,
    sleepHrs: store.sleepHrs,
  });

  const isPro = isProPlan(store.proActive);
  const pro = isPro;
  const t = (key: CopyKey, vars?: Record<string, string | number>) => translate(lang, key, vars);
  const dietCodes = (input: { name: string; allergens?: string[]; analysis?: string[]; halal?: boolean | null; contains?: string[] }) => judgeDiet(diet, input);
  const chooseUnits = (next: UnitSystem) => {
    if (next === units) return;
    const typed = Number(liftWeight);
    if (Number.isFinite(typed) && typed > 0) {
      const kg = units === 'imperial' ? lbToKg(typed) : typed;
      setLiftWeight(String(next === 'imperial' ? Math.round(kgToLb(kg)) : roundTo(kg, 1)));
    }
    setUnits(next);
    writeUnits(next);
  };

  const chooseLang = (next: Lang) => {
    setLang(next);
    writeLang(next);
    applyDocumentLanguage(next);
  };

  const blockForQuota = (kind: QuotaKind) => {
    if (canSpend(kind, pro)) return false;
    setPaywallReason(kind === 'scan' || kind === 'coach' || kind === 'kitchen' ? kind : null);
    setShowPaywall(true);
    return true;
  };

  const clearChat = () => {
    coachCancel.current = 'clear';
    coachAbort.current?.abort();
    setCoachLive(null);
    setCoachBusy(false);
    setChatInput('');
    patch({ chat: coachWelcome() });
  };

  const sendChat = (preset?: string) => {
    const text = (preset ?? chatInput).trim();
    if (!text || coachBusy) return;
    const ctx = coachContext();
    // A repeat quick-chip tap is answered from the 24-hour cache, so it never waits on the quota or the network.
    const cacheKey = preset ? coachChipKey(preset, ctx) : undefined;
    if (!(cacheKey && readTtl(cacheKey)) && blockForQuota('coach')) return;
    const system = coachSystemPrompt(ctx);
    const history = store.chat
      .filter((message) => message.id !== 1 && message.text && message.text !== 'Generating...')
      .slice(-6)
      .map((message) => ({ role: message.sender === 'user' ? 'user' as const : 'model' as const, text: message.text.slice(0, 500) }));
    const fallbackPrompt = `${system}\nUser: ${text}`;
    const userId = nextId();
    const aiId = nextId();
    coachAbort.current?.abort();
    const controller = new AbortController();
    coachAbort.current = controller;
    coachCancel.current = null;
    setChatInput('');
    setCoachBusy(true);
    setCoachLive({ id: aiId, text: '' });
    setStore((s) => {
      if (s.chat.some((message) => message.id === userId)) return s;
      return { ...s, chat: [...s.chat, { id: userId, sender: 'user', text }, { id: aiId, sender: 'ai', text: 'Generating...' }] };
    });
    void (async () => {
      let reply = '';
      let partial = '';
      try {
        reply = await streamNeural({
          kind: 'coach',
          system,
          prompt: text,
          history,
          tokens: 350,
          temperature: 0.4,
          signal: controller.signal,
          cacheKey,
          onText: (next) => {
            partial = next;
            if (mounted.current && !controller.signal.aborted) setCoachLive({ id: aiId, text: next });
          },
        });
        if (!controller.signal.aborted && lastAiWasBillable()) {
          spendQuota('coach', pro);
          if (mounted.current) setQuotaTick((tick) => tick + 1);
        }
      } catch {
        reply = '';
      } finally {
        const latest = coachAbort.current === controller;
        if (latest) coachAbort.current = null;
        if (mounted.current && latest) {
          setCoachLive(null);
          setCoachBusy(false);
          if (!controller.signal.aborted) {
            setStore((s) => ({ ...s, chat: s.chat.map((message) => (message.id === aiId ? { ...message, text: reply || localCoachFromPrompt(fallbackPrompt) } : message)) }));
          } else if (coachCancel.current !== 'clear') {
            // Left mid-answer: keep the words that arrived, or take the question back into the box.
            if (partial.trim()) setStore((s) => ({ ...s, chat: s.chat.map((message) => (message.id === aiId ? { ...message, text: partial } : message)) }));
            else {
              setStore((s) => ({ ...s, chat: s.chat.filter((message) => message.id !== userId && message.id !== aiId) }));
              setChatInput((current) => current || text);
            }
          }
        }
      }
    })();
  };

  const releaseScan = () => {
    scanLock.current = false;
    setScanBusy(false);
  };

  const holdScan = () => {
    if (scanLock.current) return false;
    scanLock.current = true;
    setScanBusy(true);
    return true;
  };

  const runScan = (task: (signal: AbortSignal) => Promise<ScanNutrition>, held = false) => {
    if (!held && scanLock.current) return;
    if (blockForQuota('scan')) {
      releaseScan();
      return;
    }
    scanAbort.current?.abort();
    const controller = new AbortController();
    scanAbort.current = controller;
    scanLock.current = true;
    setScanBusy(true);
    setScanResult(null);
    setScanNotice('');
    setScanStage('Inspecting dish...');
    const stageTimer = window.setTimeout(() => setScanStage('Calculating macros...'), 700);
    void (async () => {
      try {
        const card = await task(controller.signal);
        if (!mounted.current || controller.signal.aborted) return;
        setScanResult(card);
        setScanNotice('');
        if (lastAiWasBillable()) {
          spendQuota('scan', pro);
          setQuotaTick((tick) => tick + 1);
        }
      } catch (error) {
        if (!mounted.current || controller.signal.aborted) return;
        setScanResult(null);
        const message = error instanceof Error ? error.message : 'The scan did not finish.';
        setScanNotice(message.replace(/^Vision API limit reached:\s*/i, '').slice(0, 180));
      } finally {
        window.clearTimeout(stageTimer);
        if (scanAbort.current === controller) scanAbort.current = null;
        scanLock.current = false;
        if (mounted.current) {
          setScanBusy(false);
          setScanStage('');
        }
      }
    })();
  };

  const analyzePhoto = (jpeg: string, held = false) => {
    if (!readAiConsent()) {
      if (held) releaseScan();
      showToast(translate(readLang(), 'consentNeed'));
      return;
    }
    runScan((signal) => askGeminiScan(scanPrompt(scanNote, 'Use the attached photo. Estimate the visible portion.'), jpeg, signal), held);
  };

  /** Open Food Facts answers first and costs nothing. The AI only reads the photo when the barcode is unknown. */
  const resolveBarcode = (code: string, jpeg?: string, held = false) => {
    const clean = code.replace(/\D/g, '');
    if (clean.length < 6) {
      if (held) releaseScan();
      showToast(translate(readLang(), 'manual'));
      return;
    }
    tapHaptic();
    setBarcodeInput(clean);
    setBarcodeOpen(false);
    setAiTab('scan');
    setOffCard(null);
    setOffNote(translate(readLang(), 'looking'));
    scanAbort.current?.abort();
    const controller = new AbortController();
    scanAbort.current = controller;
    const finish = () => {
      if (scanAbort.current === controller) scanAbort.current = null;
    };
    void lookupOpenFoodFacts(clean, controller.signal).then((product) => {
      finish();
      if (!mounted.current || controller.signal.aborted) {
        if (held) releaseScan();
        return;
      }
      if (product) {
        setOffCard(product);
        setOffNote('');
        if (held) releaseScan();
      } else if (jpeg) {
        setOffNote('');
        analyzePhoto(jpeg, held);
      } else {
        setOffCard(null);
        setOffNote(translate(readLang(), 'missing'));
      }
    }).catch(() => {
      finish();
      if (!mounted.current || controller.signal.aborted) {
        if (held) releaseScan();
        return;
      }
      if (jpeg) {
        setOffNote('');
        analyzePhoto(jpeg, held);
        return;
      }
      if (held) releaseScan();
      setOffCard(null);
      setOffNote(translate(readLang(), 'missing'));
    });
  };

  const onPickScanPhoto = (file: File | undefined, asBarcode = false) => {
    if (!file || !holdScan()) return;
    scanAbort.current?.abort();
    const controller = new AbortController();
    scanAbort.current = controller;
    // The preview shows at once, before any compression starts.
    const preview = URL.createObjectURL(file);
    setScanPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return preview;
    });
    setScanResult(null);
    setScanNotice('');
    void fileToJpeg(file)
      .then((jpeg) => {
        if (controller.signal.aborted) {
          releaseScan();
          return;
        }
        if (!asBarcode && scanMode === 'photo') {
          analyzePhoto(jpeg, true);
          return;
        }
        return createImageBitmap(file).then(async (bitmap) => {
          const code = await readBarcode(bitmap);
          bitmap.close();
          if (controller.signal.aborted) {
            releaseScan();
            return;
          }
          if (code) resolveBarcode(code, jpeg, true);
          else analyzePhoto(jpeg, true);
        });
      })
      .catch(() => {
        releaseScan();
        showToast('That photo could not be read. Try another one.');
      });
  };

  const generateRecipe = (style?: string) => {
    if (recipeBusy) return;
    const chosen = style ?? craving;
    const names = store.fridge.map((item) => item.name);
    if (names.length === 0 && !chosen) {
      showToast('Add an ingredient first');
      return;
    }
    const plate = names.length > 0 ? names : [chosen];
    // The same ingredients with the same filters inside 24 hours return instantly.
    if (!readTtl(recipeCacheKey(plate, chosen)) && blockForQuota('kitchen')) return;
    kitchenAbort.current?.abort();
    const controller = new AbortController();
    kitchenAbort.current = controller;
    setRecipeBusy(true);
    setRecipe(null);
    setPacked([]);
    void (async () => {
      try {
        const next = await askGeminiRecipe(plate, chosen, controller.signal, (partial) => {
          if (mounted.current && !controller.signal.aborted) setRecipe(partial);
        });
        if (!mounted.current || controller.signal.aborted) return;
        if (next.live && lastAiWasBillable()) {
          spendQuota('kitchen', pro);
          setQuotaTick((tick) => tick + 1);
        }
        setRecipe({ title: next.title, cal: next.cal, protein: next.protein, carbs: next.carbs, fats: next.fats, steps: next.steps, halal: next.halal });
      } catch {
        if (!mounted.current || controller.signal.aborted) return;
        const local = cookFromFridge(plate);
        setRecipe({ ...local, steps: local.steps.slice(0, 4), halal: false });
      } finally {
        if (kitchenAbort.current === controller) kitchenAbort.current = null;
        if (mounted.current) {
          if (controller.signal.aborted) setRecipe(null);
          setRecipeBusy(false);
        }
      }
    })();
  };

  const removeMeal = (meal: MealItem) => {
    setStore((s) => {
      const meals = s.meals.filter((item) => item.id !== meal.id);
      return { ...s, meals, ...nutritionFromMeals(meals) };
    });
  };

  const addWater = () => {
    const step = waterStepL(units);
    setStore((s) => ({ ...s, waterL: roundTo(s.waterL + step, 4) }));
    tapHaptic();
    setWaterPulse((n) => n + 1);
    window.setTimeout(() => setWaterPulse(0), 1000);
    showToast(t('addedWater', { amount: waterStepLabel(units) }));
  };

  const removeWater = () => {
    if (store.waterL <= 0.0001) {
      showToast(t('waterAtZero'));
      return;
    }
    const step = waterStepL(units);
    setStore((s) => ({ ...s, waterL: Math.max(0, roundTo(s.waterL - step, 4)) }));
    showToast(t('removedWater', { amount: waterStepLabel(units) }));
  };

  const resetWater = () => {
    setStore((s) => ({ ...s, waterL: 0 }));
    showToast(t('waterReset'));
  };

  const pairDiscoveredWatch = (name: string, brand: string, mac?: string) => {
    const clean = name.trim().slice(0, 40);
    if (!clean) {
      showToast('Enter a watch name');
      return;
    }
    const id = mac ? bleWatchId(mac) : `bt-${hashString(`${clean}-${brand}`).toString(16)}`;
    setStore((s) => {
      const existing = s.customWatches.find((watch) => watch.id === id)
        ?? s.customWatches.find((watch) => !watch.mac && watch.name.toLowerCase() === clean.toLowerCase());
      const watch: CustomWatch = existing
        ? { ...existing, ...(mac ? { mac } : {}) }
        : { id, name: clean, brand, battery: 80, ...(mac ? { mac } : {}) };
      return {
        ...s,
        customWatches: existing ? s.customWatches.map((item) => (item.id === existing.id ? watch : item)) : [watch, ...s.customWatches].slice(0, 12),
        connectedWatch: watch.id,
      };
    });
    setScanOpen(false);
    setCustomWatchName('');
    showToast(`✓ Paired ${clean}`);
  };

  const applyHeartRate = (bpm: number, rr: number[] = []) => {
    setHeartRate(bpm);
    setBpmSamples((samples) => [...samples, bpm].slice(-8));
    if (rr.length > 0) rrWindow.current = [...rrWindow.current, ...rr].slice(-30);
    const gaps = rrWindow.current;
    if (gaps.length > 1) {
      let sum = 0;
      for (let index = 1; index < gaps.length; index += 1) sum += (gaps[index] - gaps[index - 1]) ** 2;
      setHrvMs(Math.round(Math.sqrt(sum / (gaps.length - 1))));
    }
  };

  const readHeartPacket = (view: DataView) => {
    const flags = view.getUint8(0);
    const bpm = flags & 0x01 ? view.getUint16(1, true) : view.getUint8(1);
    if (bpm < 30 || bpm > 230) return;
    let offset = flags & 0x01 ? 3 : 2;
    if (flags & 0x08) offset += 2;
    const rr: number[] = [];
    if (flags & 0x10) {
      while (offset + 1 < view.byteLength) {
        rr.push(Math.round((view.getUint16(offset, true) * 1000) / 1024));
        offset += 2;
      }
    }
    applyHeartRate(bpm, rr);
  };

  storeRef.current = store;
  bleHandler.current = (event: BleEvent) => {
    if (event.type === 'status') {
      setBleState(event.state);
      return;
    }
    if (event.type === 'device') {
      setBleDevices((rows) => {
        const prev = rows.find((row) => row.mac === event.mac);
        const next: BleDevice = {
          mac: event.mac,
          name: event.name || prev?.name || 'Bluetooth device',
          rssi: event.rssi ?? prev?.rssi ?? null,
          bonded: event.bonded || prev?.bonded === true,
          hr: event.hr || prev?.hr === true,
          bleType: event.bleType,
        };
        return [...rows.filter((row) => row.mac !== event.mac), next]
          .sort((a, b) => Number(b.bonded) - Number(a.bonded) || (b.rssi ?? -200) - (a.rssi ?? -200))
          .slice(0, 40);
      });
      return;
    }
    if (event.type === 'hr') {
      if (event.contact === false || event.bpm <= 0) {
        setHeartRate(null);
        return;
      }
      applyHeartRate(event.bpm, event.rr);
      return;
    }
    if (event.type === 'battery') {
      const level = Math.max(1, Math.min(100, Math.round(event.level)));
      setStore((s) => ({ ...s, customWatches: s.customWatches.map((watch) => (watch.mac && watch.mac === pairedMac.current ? { ...watch, battery: level } : watch)) }));
      return;
    }
    setBleLink({ mac: event.mac, state: event.state, reason: event.reason });
    if (event.state === 'disconnected') {
      pairedMac.current = '';
      setHeartRate(null);
      setHrvMs(null);
      rrWindow.current = [];
      if (event.reason && event.reason !== 'user') showToast(bleReasonText(event.reason));
      return;
    }
    if (event.state === 'connecting' || !event.mac || pairedMac.current === event.mac) return;
    pairedMac.current = event.mac;
    const name = event.name || 'Bluetooth watch';
    try {
      window.localStorage.setItem(LAST_WATCH_KEY, JSON.stringify({ mac: event.mac, name }));
    } catch {
      /* Quick reconnect is a convenience only. */
    }
    setLastWatch({ mac: event.mac, name });
    const known = storeRef.current.customWatches.find((watch) => watch.mac === event.mac);
    if (known) {
      setStore((s) => ({ ...s, connectedWatch: known.id }));
      setScanOpen(false);
      showToast(`✓ Connected ${known.name}`);
      return;
    }
    pairDiscoveredWatch(name, 'Bluetooth LE', event.mac);
  };

  const reconnectWatch = (watch: { name: string; mac?: string }) => {
    const native = nativeBle();
    if (native?.connectWatch && watch.mac) {
      setBleLink({ mac: watch.mac, state: 'connecting' });
      native.connectWatch(watch.mac, watch.name);
      return;
    }
    void scanAnyWatch();
  };

  const disconnectWatchNow = (watch: { mac?: string }) => {
    const native = nativeBle();
    if (native?.disconnectWatch && watch.mac) {
      native.disconnectWatch();
      setBleLink({ mac: watch.mac, state: 'disconnected', reason: 'user' });
    } else {
      patch({ connectedWatch: null });
    }
    pairedMac.current = '';
    rrWindow.current = [];
    setHeartRate(null);
    setHrvMs(null);
  };

  const forgetWatch = (watchId: string) => {
    const watch = store.customWatches.find((item) => item.id === watchId);
    if (watch?.mac) {
      if (bleLink?.mac === watch.mac) nativeBle()?.disconnectWatch?.();
      if (readLastWatch()?.mac === watch.mac) {
        window.localStorage.removeItem(LAST_WATCH_KEY);
        setLastWatch(null);
      }
      setBleLink((link) => (link?.mac === watch.mac ? null : link));
    }
    setStore((s) => ({
      ...s,
      customWatches: s.customWatches.filter((item) => item.id !== watchId),
      connectedWatch: s.connectedWatch === watchId ? null : s.connectedWatch,
      wristAlerts: s.wristAlerts.filter((alert) => alert.device !== watchId),
    }));
    pairedMac.current = '';
    rrWindow.current = [];
    setHeartRate(null);
    setHrvMs(null);
    showToast('Watch removed from this phone');
  };

  const connectScanned = (device: BleDevice) => {
    setBleLink({ mac: device.mac, state: 'connecting' });
    nativeBle()?.connectWatch?.(device.mac, device.name);
  };

  const listenToHeart = async (device: { gatt?: { connect: () => Promise<{ getPrimaryService: (service: string) => Promise<{ getCharacteristic: (name: string) => Promise<{ startNotifications: () => Promise<void>; addEventListener: (type: string, listener: (event: Event) => void) => void }> }> }> } | null; addEventListener: (type: string, listener: () => void) => void }) => {
    if (!device.gatt) return;
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    const characteristic = await service.getCharacteristic('heart_rate_measurement');
    const onPacket = (event: Event) => {
      const view = (event.target as EventTarget & { value?: DataView }).value;
      if (view) readHeartPacket(view);
    };
    characteristic.addEventListener('characteristicvaluechanged', onPacket);
    await characteristic.startNotifications();
    device.addEventListener('gattserverdisconnected', () => {
      setHeartRate(null);
      setHrvMs(null);
    });
  };

  const scanAnyWatch = async () => {
    const native = nativeBle();
    if (native?.startScan) {
      setBleDevices([]);
      setBleState('scanning');
      setScanOpen(true);
      native.startScan();
      return;
    }
    const bluetooth = (navigator as Navigator & { bluetooth?: { requestDevice: (options: { acceptAllDevices: boolean; optionalServices?: string[] }) => Promise<{ name?: string | null; gatt?: { connect: () => Promise<{ getPrimaryService: (service: string) => Promise<{ getCharacteristic: (name: string) => Promise<{ startNotifications: () => Promise<void>; addEventListener: (type: string, listener: (event: Event) => void) => void }> }> }> } | null; addEventListener: (type: string, listener: () => void) => void }> } }).bluetooth;
    if (!bluetooth?.requestDevice) {
      setScanOpen(true);
      return;
    }
    try {
      const device = await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ['heart_rate', 'battery_service'] });
      pairDiscoveredWatch(device.name || 'Bluetooth Watch', 'Bluetooth');
      try {
        await listenToHeart(device);
      } catch {
        setHeartRate(null);
        showToast('Paired. Heart rate starts when the watch streams 0x180D.');
      }
    } catch {
      setScanOpen(true);
    }
  };

  const openPro = () => {
    if (isPro) return;
    setPaywallReason(null);
    setShowPaywall(true);
  };

  /** The Me banner: sells the plans to free users and shows plan status and management to Pro users. */
  const openSubscription = () => {
    setPaywallReason(null);
    setShowPaywall(true);
  };

  const saveLift = () => {
    const typed = Number(liftWeight);
    const weight = Math.round((units === 'imperial' ? lbToKg(typed) : typed) * 100) / 100;
    const reps = Math.round(Number(liftReps));
    if (!Number.isFinite(weight) || weight <= 0 || weight > 500 || reps < 1 || reps > 30) {
      showToast('Enter a weight and 1–30 reps');
      return;
    }
    const entry: LiftLog = { id: nextId(), lift: liftName, weight, reps, oneRm: estimate1Rm(weight, reps), at: new Date().toISOString() };
    setStore((s) => (s.lifts.some((lift) => lift.id === entry.id) ? s : { ...s, lifts: [entry, ...s.lifts].slice(0, 30) }));
    showToast(`${entry.lift} estimated 1RM · ${formatLiftWeight(entry.oneRm, units)}`);
  };

  const music = <MusicHub />;

  const addIngredient = () => {
    const name = ingredient.trim();
    if (!name) return;
    const id = nextId();
    setStore((s) => (s.fridge.some((item) => item.id === id) ? s : { ...s, fridge: [...s.fridge, { id, name }] }));
    setIngredient('');
  };

  const startSport = (sport: string) => {
    if (workoutOn) {
      showToast('Stop the current workout first');
      return;
    }
    setSelectedSport(sport);
    setShowGps(true);
  };

  const allowGps = () => {
    if (!selectedSport) return;
    setStore((s) => ({ ...s, gpsAllowed: true }));
    setShowGps(false);
    setWorkoutSec(0);
    setWorkoutOn(true);
    setGpsLabel('Acquiring GPS…');
    if (!navigator.geolocation) {
      setGpsLabel('GPS route active');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!mounted.current) return;
        setGpsLabel(`${pos.coords.latitude.toFixed(3)}°, ${pos.coords.longitude.toFixed(3)}°`);
      },
      () => {
        if (mounted.current) setGpsLabel('GPS route active');
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 15000 },
    );
  };

  const stopWorkout = () => {
    if (!selectedSport) return;
    const seconds = workoutSec;
    const stats = trackStats(selectedSport, seconds, store.weightKg);
    const sport = selectedSport;
    const entry: WorkoutLog = {
      id: nextId(),
      sport,
      seconds,
      distanceKm: stats.distanceKm,
      calories: stats.calories,
      savedAt: new Date().toISOString(),
      focus: sport === 'Custom Workout' ? store.sessionFocus : undefined,
    };
    setWorkoutOn(false);
    setWorkoutSec(0);
    setStore((s) => {
      if (s.workouts.some((workout) => workout.id === entry.id)) return s;
      return {
        ...s,
        steps: s.steps + Math.round(stats.distanceKm * 1312),
        activeBurn: s.activeBurn + stats.calories,
        workouts: [entry, ...s.workouts].slice(0, 12),
      };
    });
    showToast(`Saved ${sport} · ${formatDistance(stats.distanceKm)} · ${Math.round(stats.calories)} kcal`);
  };

  const sendWrist = () => {
    if (!store.connectedWatch) {
      showToast('Pair a watch first');
      return;
    }
    const device = store.connectedWatch;
    const watch = WATCHES.find((item) => item.id === device) ?? store.customWatches.find((item) => item.id === device);
    const text = `${heartRate ?? '--'} BPM · ${store.steps.toLocaleString()} steps · ${store.waterL.toFixed(2)} L`;
    const alert: WristAlert = { id: nextId(), device, text, at: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) };
    setStore((s) => {
      if (s.wristAlerts.some((item) => item.device === alert.device && item.text === alert.text && item.at === alert.at)) return s;
      return { ...s, wristAlerts: uniqueAlerts([alert, ...s.wristAlerts]) };
    });
    showToast(`Alert sent to ${watch?.name ?? 'watch'}`);
  };

  const live = selectedSport ? trackStats(selectedSport, workoutSec, store.weightKg) : null;
  const fuel = FUEL[store.trainingGoal];
  const fuelShift = (store.sessionFocus === 'Pull' ? 1 : store.sessionFocus === 'Legs' ? 2 : 0) + plateCursor;
  const localPre = fuel.pre[fuelShift % fuel.pre.length];
  const localPost = fuel.post[fuelShift % fuel.post.length];
  const fuelKey = `${store.trainingGoal}|${store.sessionFocus}|${store.weightKg.toFixed(0)}|${plateCursor}|${units}|${lang}`;
  const prePlate = fuelLive?.key === fuelKey ? fuelLive.pre : localPre;
  const postPlate = fuelLive?.key === fuelKey ? fuelLive.post : localPost;

  useEffect(() => {
    if (!hydrated || activeTab !== 'sport' || !canSpend('kitchen', pro)) {
      setFuelBusy(false);
      return;
    }
    const goal = store.trainingGoal;
    const focus = store.sessionFocus;
    const weight = store.weightKg;
    const variation = plateCursor;
    const key = `${goal}|${focus}|${weight.toFixed(0)}|${variation}|${units}|${lang}`;
    const shift = (focus === 'Pull' ? 1 : focus === 'Legs' ? 2 : 0) + variation;
    const menu = FUEL[goal];
    const fallbackPre = menu.pre[shift % menu.pre.length];
    const fallbackPost = menu.post[shift % menu.post.length];
    let cancel = false;
    setFuelBusy(true);
    const prompt = [
      `Training meals for a person weighing ${formatWeight(weight, readUnits(), 0)}.`,
      `Goal: ${goal === 'fat' ? 'fat loss' : 'muscle gain'}. Session: ${focus}. Variation ${variation + 1}.`,
      preferencePrompt(),
      'One plate for 1-2 hours before training and one plate after training. Use exact gram portions. JSON only:',
      '{"pre":{"title":"","items":"60g oats · 1 banana","why":"","calories":0,"protein":0,"carbs":0,"fats":0},"post":{"title":"","items":"150g chicken · 180g rice","why":"","calories":0,"protein":0,"carbs":0,"fats":0}}',
    ].join('\n');
    void askNeural(prompt, undefined, 480, 0.4).then((text) => {
      if (cancel || !text) return;
      try {
        const data = parseJsonRecord(text);
        const pre = plateFromAi(data.pre, fallbackPre);
        const post = plateFromAi(data.post, fallbackPost);
        if (pre.items === fallbackPre.items && post.items === fallbackPost.items) return;
        if (lastAiWasBillable()) {
          spendQuota('kitchen', pro);
          setQuotaTick((tick) => tick + 1);
        }
        setFuelLive({ key, pre, post });
      } catch {
        /* Local plates stay on screen. */
      }
    }).finally(() => {
      if (!cancel) setFuelBusy(false);
    });
    return () => {
      cancel = true;
      setFuelBusy(false);
    };
  }, [hydrated, activeTab, store.trainingGoal, store.sessionFocus, store.weightKg, plateCursor, pro, units, lang]);
  const typedWeight = Number(liftWeight);
  const typedWeightKg = units === 'imperial' ? lbToKg(typedWeight) : typedWeight;
  const typedReps = Math.round(Number(liftReps));
  const previewRm = Number.isFinite(typedWeightKg) && typedWeightKg > 0 && typedReps >= 1 && typedReps <= 30 ? estimate1Rm(typedWeightKg, typedReps) : null;
  const bestLifts = LIFTS.map((name) => {
    const logs = store.lifts.filter((lift) => lift.lift === name);
    const best = logs.reduce((top, lift) => Math.max(top, lift.oneRm), 0);
    return { name, best, latest: logs[0] };
  });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('greetMorning') : hour < 17 ? t('greetAfternoon') : t('greetEvening');
  const firstName = store.userName.trim().split(/\s+/)[0] || 'there';
  const kcalLeft = Math.max(0, CAL_GOAL - eaten.calories);
  const fastingElapsed = store.isFasting && store.fastingStartedAt ? Math.max(0, Math.floor((nowTick - store.fastingStartedAt) / 1000)) : 0;
  const loggedSleep = sleepHours(store.sleepBed, store.sleepWake);
  const watchStreaming = heartRate !== null;
  const rescan = () => void scanAnyWatch();
  const bleNotice: { text: string; actions: { label: string; run: () => void }[] } | null =
    bleState === 'needs-permission' ? { text: 'Allow Nearby devices in the Android prompt so FitBite can find your watch.', actions: [{ label: 'Allow & scan', run: rescan }] }
    : bleState === 'permission-denied' ? { text: 'Bluetooth permission is off. Open app settings and allow Nearby devices (Location on Android 11 and older), then scan again.', actions: [{ label: 'Open app settings', run: () => nativeBle()?.openAppSettings?.() }, { label: 'Try again', run: rescan }] }
    : bleState === 'bluetooth-off' ? { text: 'Bluetooth is off. Turn it on to find your watch.', actions: [{ label: 'Turn on Bluetooth', run: rescan }, { label: 'Bluetooth settings', run: () => nativeBle()?.openBluetoothSettings?.() }] }
    : bleState === 'location-off' ? { text: 'Android 11 and older need Location switched on for Bluetooth scanning. FitBite does not store your location.', actions: [{ label: 'Location settings', run: () => nativeBle()?.openLocationSettings?.() }, { label: 'Try again', run: rescan }] }
    : bleState === 'unsupported' ? { text: 'This phone does not support Bluetooth Low Energy.', actions: [] }
    : bleState === 'scan-failed' ? { text: 'The scan could not start. Switch Bluetooth off and on, then try again.', actions: [{ label: 'Try again', run: rescan }] }
    : null;

  if (!hydrated) return <main className="min-h-dvh bg-[#F5F6F8]" />;

  if (prefs.appLock && prefs.pin && !unlocked) {
    return (
      <main className={`mx-auto grid min-h-dvh w-full max-w-[430px] place-items-center bg-[#F5F6F8] px-6 ${SAFE_TOP}`}>
        <div className="card w-full p-6 text-center">
          <p className="text-[11px] font-bold tracking-[0.16em] text-muted">FITBITE PRO</p>
          <h1 className="mt-2 text-2xl font-black tracking-[-0.04em]">Unlock</h1>
          <input className={`${fieldClass} mt-4 text-center tracking-[0.4em]`} inputMode="numeric" autoComplete="off" maxLength={4} value={pinDraft} placeholder="PIN" onChange={(event) => setPinDraft(event.target.value.replace(/\D/g, '').slice(0, 4))} />
          <button type="button" className={`${primaryClass} mt-4 w-full`} onClick={() => { void pinDigest(pinDraft).then((digest) => { if (digest === prefs.pin) { setUnlocked(true); setPinDraft(''); } else showToast('That PIN does not match'); }); }}>Open</button>
          {toast && <p className="mt-3 text-sm font-semibold">{toast}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className={`relative mx-auto min-h-dvh w-full max-w-[430px] bg-[#F5F6F8] ${store.flowStep === 'app' ? 'px-5' : SAFE_TOP}`}>
      {store.flowStep === 'app' && <div className="ambient-aurora" aria-hidden="true" />}
      {toast && (
        <div role="status" aria-live="polite" className="toast-in on-gradient fixed left-1/2 z-[80] w-[min(380px,calc(100%-32px))] -translate-x-1/2 rounded-full bg-[#0F1115] px-4 py-3 text-center text-sm font-extrabold shadow-[0_12px_35px_rgba(15,17,21,0.22)]" style={{ top: 'max(calc(env(safe-area-inset-top) + 8px), 48px)' }}>
          {toast}
        </div>
      )}

      {store.flowStep === 'welcome' && (
        <section className="toast-in flex min-h-dvh flex-col justify-between px-6 py-6">
          <div className="flex items-center justify-between">
            <span className="text-sm font-black tracking-[-0.04em]">FitBite Pro</span>
            <button type="button" className="text-sm text-white/60" onClick={() => patch({ flowStep: 'auth' })}>
              Skip
            </button>
          </div>
          <div className="text-center">
            <div className="glass mx-auto mb-8 grid h-60 w-60 place-items-center rounded-full">
              <div className="scale-[0.82]">
                <ActivityRings calories={1180} steps={6840} water={1.75} waterGoal={3} draw />
              </div>
            </div>
            <h1 className="text-[32px] leading-[1.05] font-black tracking-[-0.045em]">{welcomeSlide === 0 ? 'Three rings. One quiet day.' : 'Train, coach, and wear it.'}</h1>
            <p className="mx-auto mt-3 max-w-[280px] text-sm leading-relaxed text-white/55">
              {welcomeSlide === 0 ? 'Calories, steps, and water, drawn the way a serious training watch would.' : 'Ask the coach, cook from the fridge, and send a pulse to your wrist.'}
            </p>
          </div>
          <div>
            <div className="mb-5 flex justify-center gap-2">
              {[0, 1].map((slide) => (
                <button key={slide} type="button" aria-label={`Slide ${slide + 1}`} onClick={() => setWelcomeSlide(slide)} className={`h-1.5 rounded-full ${welcomeSlide === slide ? 'w-6 bg-indigo-600' : 'w-1.5 bg-slate-300'}`} />
              ))}
            </div>
            <button type="button" className={`${primaryClass} w-full`} onClick={() => (welcomeSlide === 0 ? setWelcomeSlide(1) : patch({ flowStep: 'auth' }))}>
              {welcomeSlide === 0 ? 'Next' : 'Continue'}
            </button>
          </div>
        </section>
      )}

      {store.flowStep === 'auth' && (
        <section className="toast-in flex min-h-dvh flex-col justify-center px-6 py-10">
          <p className="text-xs tracking-[0.22em] text-white/45">FITBITE PRO</p>
          <h1 className="mt-3 text-[36px] leading-[1.05] font-black tracking-[-0.045em]">Sign in</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/55">Your rings, meals, and watch stay on this device.</p>
          <div className="mt-8 flex flex-col gap-3">
            <button type="button" className={primaryClass} onClick={() => continueWith('google')}>
              Continue on this device
            </button>
            <button type="button" className={quietClass} onClick={() => continueWith('apple')}>
              Continue with a saved profile
            </button>
            <button type="button" className={quietClass} onClick={() => continueWith('huawei')}>
              Continue as a guest
            </button>
          </div>
        </section>
      )}

      {store.flowStep === 'profile' && (
        <section className="toast-in mx-auto flex min-h-dvh w-full max-w-[430px] flex-col px-5 py-6 pb-10">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold tracking-[0.16em] text-muted">PROFILE STUDIO</p>
              <h1 className="text-[32px] font-black tracking-[-0.045em]">About you</h1>
            </div>
            {!store.profileComplete && (
              <button type="button" className="text-sm text-muted" onClick={() => patch({ profileComplete: true, flowStep: 'device' })}>
                Skip
              </button>
            )}
          </div>
          <div className="card p-4">
            <p className="text-[11px] font-bold tracking-[0.14em] text-muted">THEME BADGE</p>
            <div className="mt-3 flex gap-2">
              {([
                ['pulse', '#ff2d55'],
                ['aurora', '#8b5cf6'],
                ['ember', '#f59e0b'],
                ['tide', '#0ea5e9'],
              ] as const).map(([id, color]) => (
                <button key={id} type="button" aria-label={`${id} badge`} className="grid h-12 w-12 place-items-center rounded-full text-sm font-black" style={{ background: color, color: '#fff', boxShadow: store.avatar === id ? `0 0 0 3px #fff, 0 0 0 5px ${color}` : undefined }} onClick={() => patch({ avatar: id })}>
                  {(store.userName.trim()[0] || 'A').toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <label className="card mt-3 block p-4">
            <span className="text-[11px] font-bold tracking-[0.14em] text-muted">EMAIL</span>
            <input className={`${fieldClass} mt-2`} inputMode="email" autoComplete="email" placeholder="you@email.com" value={store.userEmail} maxLength={80} onChange={(e) => patch({ userEmail: e.target.value })} />
            <span className="mt-2 flex items-center justify-between text-xs">
              <span className={emailOk(store.userEmail) ? 'font-extrabold text-[#15803d]' : 'text-muted'}>{emailOk(store.userEmail) ? 'Verified' : 'Use a full email address'}</span>
              {emailOk(store.userEmail) && <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-extrabold text-[#15803d]">Verified</span>}
            </span>
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="card block p-4">
              <span className="text-[11px] font-bold tracking-[0.14em] text-muted">NAME</span>
              <input className={`${fieldClass} mt-2`} value={store.userName} maxLength={40} onChange={(e) => patch({ userName: e.target.value })} />
            </label>
            <label className="card block p-4">
              <span className="text-[11px] font-bold tracking-[0.14em] text-muted">SEX</span>
              <select className={`${fieldClass} mt-2`} value={store.gender} onChange={(e) => patch({ gender: e.target.value === 'Female' ? 'Female' : 'Male' })}>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </label>
          </div>
          <label className="card mt-3 block p-4">
            <span className="text-[11px] font-bold tracking-[0.14em] text-muted">BIRTHDAY</span>
            <input type="date" className={`${fieldClass} mt-2`} style={{ colorScheme: 'light' }} value={store.birthday} onChange={(e) => patch({ birthday: e.target.value || store.birthday })} />
          </label>
          <div className="card mt-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">{t('height')}</span>
              <span className="text-sm font-black tabular-nums" dir="ltr">{formatHeightUnits(store.heightCm, units)}</span>
            </div>
            <input className="mt-3 w-full accent-[#0ea5e9]" type="range" aria-label={t('height')} min={units === 'imperial' ? 48 : 120} max={units === 'imperial' ? 86 : 220} value={units === 'imperial' ? Math.round(store.heightCm / 2.54) : Math.round(store.heightCm)} onChange={(e) => patch({ heightCm: units === 'imperial' ? roundTo(inToCm(Number(e.target.value)), 1) : Number(e.target.value) })} />
            <div className="mt-2 flex items-center justify-between gap-2">
              <button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-slate-100" aria-label="Decrease height" onClick={() => patch({ heightCm: nudgeHeightCm(store.heightCm, units, -1) })}>−</button>
              <button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-slate-100" aria-label="Increase height" onClick={() => patch({ heightCm: nudgeHeightCm(store.heightCm, units, 1) })}>+</button>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">{t('weight')}</span>
              <span className="text-sm font-black tabular-nums" dir="ltr">{formatWeight(store.weightKg, units, units === 'imperial' ? 0 : 1)}</span>
            </div>
            <input className="mt-3 w-full accent-[#8b5cf6]" type="range" aria-label={t('weight')} min={units === 'imperial' ? 78 : 35} max={units === 'imperial' ? 396 : 180} step={units === 'imperial' ? 1 : 0.5} value={units === 'imperial' ? Math.round(kgToLb(store.weightKg)) : store.weightKg} onChange={(e) => patch({ weightKg: units === 'imperial' ? roundTo(lbToKg(Number(e.target.value)), 3) : Number(e.target.value) })} />
            <div className="mt-2 flex items-center justify-between">
              <button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-slate-100" aria-label="Decrease weight" onClick={() => patch({ weightKg: nudgeWeightKg(store.weightKg, units, -1) })}>−</button>
              <button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-slate-100" aria-label="Increase weight" onClick={() => patch({ weightKg: nudgeWeightKg(store.weightKg, units, 1) })}>+</button>
            </div>
            {(() => {
              const bmi = bmiOf(store.weightKg, store.heightCm);
              const band = bmi < 18.5 ? { label: 'Underweight', color: '#0ea5e9' } : bmi < 25 ? { label: 'Normal', color: '#22c55e' } : { label: 'Overweight', color: '#f59e0b' };
              const marker = Math.min(96, Math.max(4, ((bmi - 15) / 20) * 100));
              return (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs font-extrabold">
                    <span>BMI {bmi.toFixed(1)}</span>
                    <span style={{ color: band.color }}>{band.label}</span>
                  </div>
                  <div className="relative mt-2 h-2 rounded-full bg-gradient-to-r from-[#0ea5e9] via-[#22c55e] to-[#f59e0b]">
                    <span className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white" style={{ left: `${marker}%`, background: band.color }} />
                  </div>
                  <p className="mt-3 text-xs text-muted">Daily target preview · {maintainKcal(store.weightKg, store.heightCm, ageOf(store.birthday), store.gender)} kcal · {formatWater(waterTargetL(store.weightKg), units)} water</p>
                </div>
              );
            })()}
          </div>
          <button type="button" className={`${primaryClass} mt-4 w-full`} onClick={finishProfile}>
            {store.profileComplete ? t('save') : t('saveContinue')}
          </button>
        </section>
      )}

      {store.flowStep === 'device' && (
        <section className="toast-in flex min-h-dvh flex-col justify-between px-6 py-8">
          <div>
            <h1 className="text-[32px] leading-[1.05] font-black tracking-[-0.045em]">How should FitBite track you?</h1>
            <div className="mt-6 flex flex-col gap-3">
              {WATCHES.map((watch) => (
                <button key={watch.id} type="button" className="card flex items-center gap-4 p-5 text-left" onClick={() => { patch({ flowStep: 'app' }); void scanAnyWatch(); }}>
                  <WatchFace kind={watch.id} bpm={heartRate} alert={null} compact />
                  <span>
                    <span className="block font-semibold">{watch.name}</span>
                    <span className="mt-1 block text-sm text-white/50">{watch.model}</span>
                  </span>
                </button>
              ))}
              <button type="button" className="card-quiet p-5 text-left" onClick={() => { patch({ flowStep: 'app' }); showToast('Phone tracking on'); }}>
                <span className="block font-semibold">Use this phone</span>
                <span className="mt-1 block text-sm text-white/50">Steps, meals, and workouts without a watch.</span>
              </button>
            </div>
          </div>
          <button type="button" className={`${quietClass} mt-6 w-full`} onClick={() => patch({ flowStep: 'app' })}>
            Not now
          </button>
        </section>
      )}

      {store.flowStep === 'app' && (
        <>
          <header className="safe-top-bar lux-rise sticky top-0 z-30 -mx-5 mb-5 flex items-center justify-between gap-3 px-5 pb-3">
            <div className="min-w-0">
              {activeTab === 'today' ? (
                <>
                  <p className="text-[13px] font-semibold text-muted">{greeting}</p>
                  <h1 className="flex items-center gap-2 truncate text-[2rem] font-black tracking-[-0.045em]">{firstName}{isPro && <span className="on-gradient rounded-full bg-[#0f1115] px-2 py-0.5 text-[10px] font-extrabold tracking-[0.14em]">PRO</span>}</h1>
                </>
              ) : (
                <h1 className="truncate text-[1.65rem] font-black tracking-[-0.045em]">
                  {activeTab === 'health' ? t('health') : activeTab === 'ai' ? t('ai') : activeTab === 'sport' ? t('sport') : t('me')}
                </h1>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="glass-quiet flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold">
                <Icon name="flame" className="h-3.5 w-3.5 text-[#ff9f0a]" />
                <span className="tabular-nums">{store.streak}</span>
              </div>
              <button type="button" className="btn-primary grid h-11 w-11 place-items-center rounded-full text-sm font-black on-gradient" onClick={() => setActiveTab('me')} aria-label="Open profile">
                {(store.userName.trim()[0] || 'A').toUpperCase()}
              </button>
            </div>
          </header>

          {activeTab === 'today' && (
            <section className="lux-stage tab-scroll">
              <div className="obsidian-hero px-5 py-7">
                <div className="relative grid place-items-center">
                  <ActivityRings calories={eaten.calories} steps={store.steps} water={store.waterL} waterGoal={waterGoalL(units)} draw={drawRings} night />
                  <div className="pointer-events-none absolute w-[62px] text-center">
                    <div className="text-[26px] leading-none font-black tabular-nums tracking-[-0.05em]">{kcalLeft}</div>
                    <div className="mt-1 text-[8px] leading-tight font-bold tracking-[0.12em] text-muted uppercase">{eaten.calories >= CAL_GOAL ? t('goalMet') : t('kcalLeft')}</div>
                  </div>
                </div>
                <p className="sr-only">
                  Calories {eaten.calories} of {CAL_GOAL}. Steps {store.steps} of {STEP_GOAL}. Water {formatWater(store.waterL, units)} of {formatWaterGoal(units)}.
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: t('calories'), color: '#ff2d55', value: eaten.calories.toLocaleString(), goal: CAL_GOAL.toLocaleString() },
                    { label: t('steps'), color: '#22c55e', value: store.steps.toLocaleString(), goal: STEP_GOAL.toLocaleString() },
                    { label: t('water'), color: '#0ea5e9', value: formatWater(store.waterL, units), goal: formatWaterGoal(units) },
                  ].map((item) => (
                    <div key={item.label}>
                      <div className="text-[11px] font-extrabold" style={{ color: item.color }}>{item.label}</div>
                      <div className="mt-1 text-sm font-extrabold tabular-nums">{item.value}</div>
                      <div className="text-[10px] font-semibold text-muted">{item.goal}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <div className="glass relative flex h-14 min-w-0 flex-1 items-center overflow-hidden rounded-full">
                  {waterPulse > 0 && <span key={waterPulse} className="action-fill absolute inset-0 bg-[#64d2ff]/30" />}
                  <button type="button" className="relative h-full flex-1 text-sm font-extrabold" onClick={removeWater}>-{waterStepLabel(units)}</button>
                  <button type="button" className="relative flex h-full flex-1 items-center justify-center gap-1 text-sm font-extrabold" onClick={addWater}>
                    <Icon name="water" className="h-4 w-4 text-[#0ea5e9]" />
                    +{waterStepLabel(units)}
                  </button>
                  <button type="button" className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-black text-muted" aria-label="Reset water" onClick={resetWater}>↺</button>
                </div>
                <button type="button" className={primaryClass} onClick={() => setShowMealLog((open) => !open)}>
                  {t('logMeal')}
                </button>
              </div>
              {music}

              {showMealLog && (
                <div className="card mt-4 p-5">
                  <h2 className="text-sm font-black tracking-[-0.02em]">Log a meal</h2>
                  <input
                    className={`${fieldClass} mt-3`}
                    value={foodQuery}
                    placeholder="Chicken biryani, oats, salad"
                    maxLength={80}
                    onChange={(e) => onEditName(e.target.value)}
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {['Chicken biryani', 'Boiled eggs', 'Green salad', 'Grilled chicken', 'Greek yogurt'].map((chip) => (
                      <button key={chip} type="button" className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200" onClick={() => onEditName(chip)}>
                        {chip}
                      </button>
                    ))}
                  </div>
                  {aiResult && (
                    <div className="mt-3">
                      <div className="text-2xl font-semibold tabular-nums">{aiResult.calories}<span className="ml-1 text-sm font-medium text-white/45">kcal</span></div>
                      <div className="mt-1 text-xs text-white/50">P {aiResult.protein}g · C {aiResult.carbs}g · F {aiResult.fats}g</div>
                      <button type="button" className={`${primaryClass} mt-3 w-full`} onClick={() => logMeal(aiResult)}>
                        {t('addToToday')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="card mt-4 p-5">
                <div className="mb-3 flex items-center justify-between text-sm">
                  <span className="font-black tracking-[-0.02em]">{t('macros')}</span>
                  <span className="text-white/45">{kcalLeft > 0 ? `${kcalLeft} kcal left` : 'Goal met'}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: t('protein'), value: eaten.protein, goal: 150, color: '#ff2d55' },
                    { label: t('carbs'), value: eaten.carbs, goal: 220, color: '#f59e0b' },
                    { label: t('fat'), value: eaten.fats, goal: 75, color: '#22c55e' },
                  ].map((macro) => (
                    <div key={macro.label} className="glass-quiet rounded-2xl px-2.5 py-3">
                      <div className="text-[11px] font-extrabold" style={{ color: macro.color }}>{macro.label}</div>
                      <div className="mt-1 text-[13px] font-black tabular-nums tracking-[-0.03em]">{macro.value}g <span className="text-[11px] font-semibold text-muted">/ {macro.goal}g</span></div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (macro.value / macro.goal) * 100)}%`, background: macro.color }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card mt-4 p-5">
                <div className="mb-1 flex items-center justify-between">
                  <h2 className="text-sm font-black tracking-[-0.02em]">{t('meals')}</h2>
                  <button type="button" className="text-xs font-semibold text-[#64d2ff]" onClick={() => setShowMealLog(true)}>
                    Add
                  </button>
                </div>
                {store.meals.length === 0 && <p className="py-6 text-center text-sm text-white/40">{t('nothingLogged')}</p>}
                {store.meals.map((meal) => (
                  <div key={meal.id} className="flex items-center justify-between gap-3 border-t border-white/10 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{meal.name}</div>
                      <div className="text-xs text-white/40">{meal.calories} kcal · P {meal.protein}g · {meal.time}</div>
                    </div>
                    <button type="button" className="text-white/35" aria-label={`Remove ${meal.name}`} onClick={() => removeMeal(meal)}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeTab === 'health' && (
            <section className="tab-scroll">
              <div className="grid grid-cols-2 gap-3">
                <button type="button" className="card p-3.5 text-left" onClick={() => setActiveTab('me')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-2xl text-xs font-black text-[#ff2d55]" style={{ background: 'rgba(255,45,85,0.12)' }}>♥</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-extrabold text-slate-500">{watchStreaming ? 'Live' : t('noWatch')}</span>
                  </div>
                  <div className="mt-3 text-[11px] font-bold text-muted">{t('heartRate')}</div>
                  <div className="mt-0.5 text-[1.65rem] leading-none font-black tabular-nums tracking-[-0.04em]">{watchStreaming ? heartRate : '--'}<span className="ml-1 text-xs font-semibold text-muted">BPM</span></div>
                  {watchStreaming && bpmSamples.length > 1 ? (
                    <svg viewBox="0 0 72 24" className="mt-2 h-6 w-full" aria-hidden="true">
                      <path d={bpmSamples.map((point, index) => {
                        const min = Math.min(...bpmSamples);
                        const span = Math.max(1, Math.max(...bpmSamples) - min);
                        return `${index === 0 ? 'M' : 'L'} ${(index / (bpmSamples.length - 1)) * 72} ${22 - ((point - min) / span) * 16}`;
                      }).join(' ')} fill="none" stroke="#ff2d55" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  ) : <p className="mt-2 text-[11px] font-semibold text-muted">Tap to open Watch Hub</p>}
                </button>
                <button type="button" className="card p-3.5 text-left" onClick={() => setActiveTab('me')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-2xl text-[10px] font-black text-[#0ea5e9]" style={{ background: 'rgba(14,165,233,0.12)' }}>O₂</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-extrabold text-slate-500">{watchStreaming ? 'Not streamed' : t('noWatch')}</span>
                  </div>
                  <div className="mt-3 text-[11px] font-bold text-muted">{t('spo2')}</div>
                  <div className="mt-0.5 text-[1.65rem] leading-none font-black tabular-nums tracking-[-0.04em]">--<span className="ml-1 text-xs font-semibold text-muted">%</span></div>
                  <p className="mt-2 text-[11px] font-semibold text-muted">Needs a pulse-ox packet</p>
                </button>
                <button type="button" className="card p-3.5 text-left" onClick={() => setActiveTab('me')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-2xl text-xs font-black text-[#22c55e]" style={{ background: 'rgba(34,197,94,0.12)' }}>~</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-extrabold text-slate-500">{hrvMs !== null ? 'From RR intervals' : t('noWatch')}</span>
                  </div>
                  <div className="mt-3 text-[11px] font-bold text-muted">{t('hrv')}</div>
                  <div className="mt-0.5 text-[1.65rem] leading-none font-black tabular-nums tracking-[-0.04em]">{hrvMs ?? '--'}<span className="ml-1 text-xs font-semibold text-muted">ms</span></div>
                  <p className="mt-2 text-[11px] font-semibold text-muted">{hrvMs !== null ? 'RMSSD from the live packet' : 'Waiting for RR intervals'}</p>
                </button>
                <button type="button" className="card p-3.5 text-left" onClick={() => { setSleepDraftBed(store.sleepBed || '23:00'); setSleepDraftWake(store.sleepWake || '07:00'); setSleepOpen(true); }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-2xl text-xs font-black text-[#8b5cf6]" style={{ background: 'rgba(139,92,246,0.12)' }}>☾</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-extrabold text-slate-500">{loggedSleep > 0 ? sleepStatus(loggedSleep) : 'Not logged'}</span>
                  </div>
                  <div className="mt-3 text-[11px] font-bold text-muted">{t('sleep')}</div>
                  <div className="mt-0.5 text-[1.65rem] leading-none font-black tabular-nums tracking-[-0.04em]">{loggedSleep > 0 ? loggedSleep.toFixed(1) : '--'}<span className="ml-1 text-xs font-semibold text-muted">h</span></div>
                  <p className="mt-2 text-[11px] font-semibold text-muted">{loggedSleep > 0 ? `${store.sleepBed}–${store.sleepWake}` : 'Tap to log bedtime'}</p>
                </button>
              </div>
              {sleepOpen && (
                <div className="card mt-3 p-4">
                  <p className="text-sm font-extrabold">Log last night</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="text-xs font-semibold text-muted">Bedtime<input className={`${fieldClass} mt-1`} type="time" value={sleepDraftBed} onChange={(event) => setSleepDraftBed(event.target.value)} /></label>
                    <label className="text-xs font-semibold text-muted">Wake<input className={`${fieldClass} mt-1`} type="time" value={sleepDraftWake} onChange={(event) => setSleepDraftWake(event.target.value)} /></label>
                  </div>
                  <button type="button" className={`${primaryClass} mt-3 w-full`} onClick={() => {
                    if (!clockTime(sleepDraftBed) || !clockTime(sleepDraftWake)) {
                      showToast('Enter a bedtime and wake time');
                      return;
                    }
                    const hours = sleepHours(sleepDraftBed, sleepDraftWake);
                    patch({ sleepBed: sleepDraftBed, sleepWake: sleepDraftWake, sleepHrs: hours });
                    setSleepOpen(false);
                    showToast(`Sleep logged · ${hours.toFixed(1)} h`);
                  }}>Save sleep</button>
                </div>
              )}
              <div className="card mt-3 p-5">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold tracking-[0.18em] text-muted">16:8 FASTING</div>
                  <span className="rounded-full bg-[#fff4e5] px-2.5 py-1 text-[10px] font-extrabold text-[#c2410c]">{fastStage(fastingElapsed)}</span>
                </div>
                <div className="mt-4 flex items-center gap-4">
                  <svg viewBox="0 0 88 88" className="h-[88px] w-[88px] shrink-0" aria-hidden="true">
                    <circle cx="44" cy="44" r="34" fill="none" stroke="#ffe8cc" strokeWidth="8" />
                    <circle cx="44" cy="44" r="34" fill="none" stroke="#f59e0b" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${2 * Math.PI * 34} ${2 * Math.PI * 34}`} strokeDashoffset={2 * Math.PI * 34 * (1 - (store.isFasting ? Math.min(1, fastingElapsed / (16 * 3600)) : 0))} transform="rotate(-90 44 44)" />
                  </svg>
                  <div className="min-w-0">
                    <div className="text-4xl font-black tabular-nums tracking-[-0.05em]">{formatTime(fastingElapsed)}</div>
                    <div className="mt-2 flex gap-4 text-[11px] font-semibold text-muted">
                      <span>Start {store.isFasting && store.fastingStartedAt ? new Date(store.fastingStartedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}</span>
                      <span>Goal {store.isFasting && store.fastingStartedAt ? new Date(store.fastingStartedAt + 16 * 3600 * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '16h'}</span>
                    </div>
                  </div>
                </div>
                <button type="button" className={`${primaryClass} mt-4 w-full`} onClick={() => {
                  if (store.isFasting && store.fastingStartedAt) {
                    const seconds = Math.max(0, Math.floor((Date.now() - store.fastingStartedAt) / 1000));
                    patch({ isFasting: false, fastingStartedAt: null });
                    showToast(`Fast saved · ${formatTime(seconds)}`);
                    return;
                  }
                  const started = Date.now();
                  setNowTick(started);
                  patch({ isFasting: true, fastingStartedAt: started });
                }}>
                  {store.isFasting ? t('endFast') : t('startFasting')}
                </button>
              </div>
              <p className="mt-3 px-1 text-[11px] leading-relaxed text-muted">{t('disclaimer')}</p>
            </section>
          )}

          {activeTab === 'ai' && (
            <section className="tab-scroll">
              {(() => {
                const kind: QuotaKind = aiTab === 'coach' ? 'coach' : aiTab === 'kitchen' ? 'kitchen' : 'scan';
                const usage = quotaLeft(kind, pro);
                const copy: CopyKey = kind === 'coach' ? 'coachLeft' : kind === 'kitchen' ? 'recipesLeft' : 'scansLeft';
                return isPro ? (
                  <div className="mb-3 rounded-full bg-white px-4 py-2 text-xs font-extrabold shadow-[0_8px_20px_rgba(15,23,42,0.05)]" key={quotaTick}>{t('proActive')} · {t('unlimited')}</div>
                ) : (
                  <button type="button" key={quotaTick} className="mb-3 flex w-full items-center justify-between rounded-full bg-white px-4 py-2 text-start text-xs font-extrabold shadow-[0_8px_20px_rgba(15,23,42,0.05)]" onClick={() => { setPaywallReason(null); setShowPaywall(true); }}>
                    <span className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${usage.left === 0 ? 'bg-[#f43f5e]' : 'bg-[#22c55e]'}`} aria-hidden="true" />
                      {t(copy, { n: usage.left, max: usage.limit })}
                    </span>
                    <span className="rtl-flip text-muted" aria-hidden="true">›</span>
                  </button>
                );
              })()}
              {challenge && (
                <div className="mb-3">
                  <button type="button" className="flex w-full items-center justify-between rounded-full bg-white px-4 py-2 text-left text-xs font-extrabold shadow-[0_8px_20px_rgba(15,23,42,0.05)]" aria-expanded={challengeOpen} onClick={() => setChallengeOpen((open) => !open)}>
                    <span className="truncate">{t('challengeTitle')}{challenge.completed ? ` · ${t('completed')}` : ''}</span>
                    <span className="shrink-0 text-muted">{challengeOpen ? t('hide') : t('show')}</span>
                  </button>
                {challengeOpen && (
                <article className="obsidian-hero on-gradient mt-2 px-4 py-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold tracking-[0.08em]" style={{ background: 'rgba(255,255,255,0.1)' }}>{t('challengeTitle')}</span>
                    <span className="shrink-0 text-[10px] font-extrabold tracking-wide text-[#c4b5fd]">{store.streak} day streak</span>
                  </div>
                  <h3 className="mt-2.5 text-[15px] leading-tight font-black tracking-[-0.03em]">{challenge.title}</h3>
                  <p className="mt-1 text-[12px] leading-snug text-[#9aa3b2]">{challenge.tip}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      className={`h-9 flex-1 rounded-full text-xs font-extrabold ${challenge.completed ? 'bg-[#dcfce7] text-[#047857]' : 'bg-white text-[#0f1115]'}`}
                      disabled={challenge.completed}
                      onClick={completeChallenge}
                    >
                      {challenge.completed ? `✓ ${t('completed')}` : t('complete')}
                    </button>
                    <button
                      type="button"
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full disabled:opacity-35" style={{ background: 'rgba(255,255,255,0.1)' }}
                      aria-label={challenge.swaps >= 2 ? 'No swaps left today' : 'Swap challenge'}
                      disabled={challenge.completed || challenge.swaps >= 2}
                      onClick={swapChallenge}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 8h13l-3-3M20 16H7l3 3" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="h-9 shrink-0 rounded-full px-3 text-[11px] font-extrabold" style={{ background: 'rgba(255,255,255,0.1)' }}
                      onClick={() => reportAi('challenge', `${challenge.title}. ${challenge.tip}`)}
                    >
                      {t('report')}
                    </button>
                  </div>
                </article>
                )}
                </div>
              )}
              <div className="card-quiet mb-4 grid grid-cols-3 rounded-full p-1 text-[11px] font-extrabold">
                {([
                  ['coach', 'coach'],
                  ['kitchen', 'kitchen'],
                  ['scan', 'scan'],
                ] as const).map(([id, label]) => (
                  <button key={id} type="button" className={`h-9 rounded-full ${aiTab === id ? 'btn-primary on-gradient' : 'text-muted'}`} onClick={() => setAiTab(id)}>
                    {t(label)}
                  </button>
                ))}
              </div>
              <div className="chip-row mb-3">
                <button type="button" className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-extrabold shadow-sm" onClick={() => chooseLang(LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length])}>{lang.toUpperCase()}</button>
                {DIET_FLAGS.map((flag) => (
                  <button key={flag} type="button" className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-extrabold ${diet[flag] ? 'bg-[#dcfce7] text-[#047857]' : 'bg-white text-slate-600 shadow-sm'}`} onClick={() => setDiet((current) => { const next = { ...current, [flag]: !current[flag] }; writeDiet(next); return next; })}>
                    {t(flag)}
                  </button>
                ))}
              </div>
              {aiTab === 'kitchen' && (
                <div className="card p-5">
                  <h3 className="font-black tracking-[-0.03em]">{t('fridge')}</h3>
                  <p className="mt-1 text-xs text-muted">Live recipes from the fridge.</p>
                  <div className="chip-row mt-3">
                    {CRAVINGS.map((item) => (
                      <button key={item} type="button" className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-extrabold ${craving === item ? 'btn-primary on-gradient' : 'bg-slate-100 text-slate-700'}`} onClick={() => { setCraving(item); generateRecipe(item); }}>
                        {item}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <input className={fieldClass} value={ingredient} placeholder={t('fridgePlaceholder')} onChange={(e) => setIngredient(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addIngredient(); }} />
                    <button type="button" className={primaryClass} onClick={addIngredient}>{t('add')}</button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {store.fridge.map((item) => (
                      <button key={item.id} type="button" className="rounded-full bg-white/10 px-3 py-1.5 text-xs" onClick={() => setStore((s) => ({ ...s, fridge: s.fridge.filter((f) => f.id !== item.id) }))}>
                        {item.name} ✕
                      </button>
                    ))}
                  </div>
                  <button type="button" className={`${primaryClass} mt-4 w-full`} disabled={recipeBusy} onClick={() => generateRecipe()}>
                    {recipeBusy ? t('generating') : t('generateRecipe')}
                  </button>
                  {recipeBusy && !recipe && <p className="mt-3 flex items-center gap-2 text-sm font-semibold"><span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>{t('generating')}</p>}
                  {recipe && (
                    <div className="glass-quiet mt-3 rounded-3xl p-4">
                      <div className="flex items-center gap-2">
                        <div className="font-extrabold tracking-[-0.02em]">{recipe.title}</div>
                        {recipe.halal && <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-extrabold text-[#047857]">✓ Halal</span>}
                      </div>
                      {recipe.title !== 'API Error' && recipe.cal > 0 && (
                        <>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {[
                              ['Calories', `${recipe.cal}`, '#ff2d55'],
                              ['Protein', `${recipe.protein}g`, '#0ea5e9'],
                              ['Carbs', `${recipe.carbs}g`, '#f59e0b'],
                              ['Fat', `${recipe.fats}g`, '#22c55e'],
                            ].map(([label, value, color]) => (
                              <span key={label} className="rounded-full px-2.5 py-1 text-[11px] font-extrabold" style={{ background: `${color}18`, color }}>
                                {label} {value}
                              </span>
                            ))}
                          </div>
                          <p className="mt-3 rounded-2xl bg-[#fff7ed] px-3 py-2 text-xs leading-relaxed text-[#9a3412]">
                            <span className="font-extrabold">Chef Pro Tip. </span>
                            Season in the pan and plate the hottest item last so the macros stay in one serving.
                          </p>
                        </>
                      )}
                      {store.fridge.length > 0 && (
                        <ul className="mt-3 space-y-1.5">
                          {store.fridge.map((item) => {
                            const on = packed.includes(item.id);
                            return (
                              <li key={item.id}>
                                <button type="button" className="flex w-full items-center gap-2 rounded-2xl bg-white px-3 py-2 text-left text-sm" onClick={() => setPacked((rows) => on ? rows.filter((id) => id !== item.id) : [...rows, item.id])}>
                                  <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-black ${on ? 'bg-[#dcfce7] text-[#047857]' : 'bg-slate-100 text-slate-400'}`}>{on ? '✓' : ''}</span>
                                  {item.name}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      <ol className="mt-3 list-decimal space-y-2 pl-4 text-sm leading-relaxed text-slate-700">
                        {recipe.steps.map((step, index) => (
                          <li key={`${index}-${step.slice(0, 24)}`}>{step}</li>
                        ))}
                      </ol>
                      {recipe.title !== 'API Error' && recipe.cal > 0 && !recipeBusy && (
                        <button
                          type="button"
                          className={`${primaryClass} mt-4 w-full`}
                          onClick={() => logMeal({ name: recipe.title, calories: recipe.cal, protein: recipe.protein, carbs: recipe.carbs, fats: recipe.fats, score: 9, advice: recipe.steps[0] ?? '' })}
                        >
                          Log Meal to Today
                        </button>
                      )}
                      <button type="button" className="mt-3 text-[11px] font-semibold text-muted underline" onClick={() => reportAi('kitchen', recipe.title)}>Report inaccurate AI result</button>
                    </div>
                  )}
                </div>
              )}

              {aiTab === 'scan' && (
                <div className="card p-5">
                  <h3 className="font-black tracking-[-0.03em]">AI Scan</h3>
                  <p className="mt-1 text-xs text-muted">The phone camera opens, then the photo lands in this frame.</p>
                  <div className="relative mt-3 aspect-[4/3] overflow-hidden rounded-[28px] bg-[#f4f7fb] shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]">
                    {scanPreview ? <img src={scanPreview} alt="Selected food" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center px-8 text-center text-sm text-muted">A crisp preview appears the moment you take or pick a photo.</div>}
                    <div className="pointer-events-none absolute inset-4 rounded-[22px] border border-white/80 shadow-[0_0_0_1px_rgba(16,185,129,0.35)]" />
                    {scanBusy && scanPreview && (
                      <div className="scan-veil pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true"><div className="scan-laser" /></div>
                    )}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button type="button" className={`${primaryClass} min-w-0 flex-1`} disabled={scanBusy} onClick={() => { setScanMode('photo'); cameraInputRef.current?.click(); }}><Glyph name="camera" />{scanBusy ? t('analyzing') : t('takePhoto')}</button>
                    <button type="button" className={quietClass} disabled={scanBusy} onClick={() => { setScanMode('photo'); galleryInputRef.current?.click(); }}><Glyph name="image" />{t('gallery')}</button>
                  </div>
                  <button type="button" className={`mt-2 h-9 rounded-full px-4 text-xs font-extrabold ${scanMode === 'barcode' ? 'btn-primary on-gradient' : 'bg-slate-100 text-slate-700'}`} onClick={() => { setScanMode('barcode'); setBarcodeOpen(true); }}>{t('barcodeShort')}</button>
                  <input ref={cameraInputRef} className="hidden" type="file" accept="image/*" capture="environment" onChange={(event) => { onPickScanPhoto(event.target.files?.[0], scanMode === 'barcode'); event.target.value = ''; }} />
                  <input ref={galleryInputRef} className="hidden" type="file" accept="image/*" onChange={(event) => { onPickScanPhoto(event.target.files?.[0], scanMode === 'barcode'); event.target.value = ''; }} />
                  {scanMode === 'barcode' && (
                    <div className="mt-3 space-y-2">
                      <div className="flex gap-2">
                        <input className={fieldClass} inputMode="numeric" placeholder="Barcode, e.g. 3017620422003" value={barcodeInput} maxLength={14} onChange={(event) => setBarcodeInput(event.target.value)} />
                        <button type="button" className={primaryClass} disabled={scanBusy} onClick={() => resolveBarcode(barcodeInput)}>Look up</button>
                      </div>
                      <button type="button" className={`${quietClass} w-full`} disabled={scanBusy} onClick={() => galleryInputRef.current?.click()}>Scan barcode photo</button>
                    </div>
                  )}
                  <div className="mt-3 flex gap-2">
                    <input className={fieldClass} value={scanNote} maxLength={160} placeholder="Add note or tap mic..." onChange={(event) => setScanNote(event.target.value)} />
                    <MicButton hot={voiceFor === 'scan'} phase={voicePhase} label="Dictate a meal" disabled={voiceFor !== null && voiceFor !== 'scan'} onClick={() => dictate('scan', setScanNote)} />
                  </div>
                  {voiceFor === 'scan' && voiceNote && <p className="mt-2 text-sm font-semibold text-slate-700">{voiceNote}</p>}
                  {scanBusy && <p className="mt-3 text-sm font-semibold">{scanStage || 'Inspecting dish...'}</p>}
                  {scanNotice && <p className="mt-3 text-sm font-semibold text-slate-700">{scanNotice}</p>}
                  {offNote && <p className="mt-3 text-sm font-semibold text-slate-700">{offNote}</p>}
                  {offCard && (
                    <div className="glass-quiet mt-3 rounded-3xl p-4">
                      <div className="flex gap-3">
                        {offCard.image && <img src={offCard.image} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover" />}
                        <div className="min-w-0">
                          <div className="truncate text-lg font-black tracking-[-0.03em]">{offCard.name}</div>
                          {offCard.brand && <div className="text-xs text-muted">{offCard.brand}</div>}
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {offCard.nutriscore && <span className="rounded-full px-2 py-0.5 text-[10px] font-extrabold text-white" style={{ background: NUTRI_COLOR[offCard.nutriscore] }}>Nutri-Score {offCard.nutriscore.toUpperCase()}</span>}
                            {offCard.nova && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-slate-700">NOVA {offCard.nova} {t(offCard.nova === 1 ? 'nova1' : offCard.nova === 2 ? 'nova2' : offCard.nova === 3 ? 'nova3' : 'nova4')}</span>}
                          </div>
                        </div>
                      </div>
                      <DietBadges codes={dietCodes({ name: `${offCard.name} ${offCard.brand}`, allergens: offCard.allergens, analysis: offCard.analysis })} label={t} />
                      {([
                        [t('per100'), offCard.per100],
                        offCard.perServing ? [t('perServing'), offCard.perServing] : null,
                      ] as const).filter((row): row is readonly [string, NonNullable<OffProduct['perServing']>] => row !== null).map(([label, row]) => (
                        <div key={label} className="mt-3">
                          <div className="text-[10px] font-extrabold tracking-wide text-muted">{label}{label === t('perServing') && offCard.serving ? ` · ${offCard.serving}` : ''}</div>
                          <div className="mt-1 grid grid-cols-4 gap-1.5 text-center">
                            {([
                              [t('calories'), `${Math.round(row.calories)}`],
                              [t('protein'), `${row.protein}g`],
                              [t('carbs'), `${row.carbs}g`],
                              [t('fat'), `${row.fat}g`],
                              ['Sugar', `${row.sugar}g`],
                              ['Salt', `${row.salt}g`],
                              ['Sodium', `${row.sodiumMg}mg`],
                              ['Fiber', `${row.fiber}g`],
                            ] as const).map(([name, value]) => (
                              <div key={`${label}-${name}`} className="rounded-2xl bg-white px-1 py-1.5">
                                <div className="text-[9px] font-bold text-muted">{name}</div>
                                <div className="text-[11px] font-black tabular-nums">{value}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {(offCard.nutriscore === 'd' || offCard.nutriscore === 'e') && <p className="mt-3 text-sm font-semibold text-slate-700">{offCard.nutriscore === 'd' ? t('smartD') : t('smartE')}</p>}
                      <button type="button" className={`${primaryClass} mt-4 w-full`} onClick={() => { const row = offCard.perServing ?? offCard.per100; logMeal({ name: offCard.name, calories: Math.round(row.calories), protein: row.protein, carbs: row.carbs, fats: row.fat, score: 0, advice: '' }); }}>{t('addToToday')}</button>
                      <button type="button" className="mt-3 text-[11px] font-semibold text-muted underline" onClick={() => reportAi('scan', offCard.name)}>{t('report')}</button>
                    </div>
                  )}
                  {scanResult && (
                    <div className="glass-quiet mt-3 rounded-3xl p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="text-lg font-black tracking-[-0.03em]">{scanResult.name}</div>
                            {scanResult.halal && <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-extrabold text-[#047857]">✓ {t('halalOk')}</span>}
                          </div>
                          <div className="mt-1 text-xs text-muted">{scanResult.servingG > 0 ? `${scanResult.servingG} g serving` : 'Serving estimate'}</div>
                        </div>
                        <span className="rounded-full px-2.5 py-1 text-[11px] font-extrabold" style={{ background: (scanResult.score ?? 0) >= 8 ? '#dcfce7' : (scanResult.score ?? 0) >= 5 ? '#fef3c7' : '#ffe4e6', color: (scanResult.score ?? 0) >= 8 ? '#15803d' : (scanResult.score ?? 0) >= 5 ? '#b45309' : '#be123c' }}>
                          {scanResult.score === null ? 'Score —' : `Health ${scanResult.score}/10`}
                        </span>
                      </div>
                      <div className="mt-3 text-3xl font-black tabular-nums tracking-[-0.04em]">{scanResult.calories}<span className="ml-1 text-sm font-semibold text-muted">kcal</span></div>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {[
                          ['Carbs', `${scanResult.carbs}g`, '#f59e0b'],
                          ['Protein', `${scanResult.protein}g`, '#ff2d55'],
                          ['Fat', `${scanResult.fat}g`, '#22c55e'],
                        ].map(([label, value, color]) => (
                          <div key={label} className="rounded-2xl bg-white px-2 py-2">
                            <div className="text-[10px] font-extrabold" style={{ color }}>{label}</div>
                            <div className="text-sm font-black tabular-nums">{value}</div>
                          </div>
                        ))}
                      </div>
                      {(scanResult.fiber + scanResult.calcium + scanResult.iron + scanResult.sugar + scanResult.sodium > 0 || scanResult.vitamins.length > 0) && (
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        {[
                          ['Fiber', `${scanResult.fiber} g`],
                          ['Calcium', `${scanResult.calcium} mg`],
                          ['Iron', `${scanResult.iron} mg`],
                          ['Sugar', `${scanResult.sugar} g`],
                          ['Sodium', `${scanResult.sodium} mg`],
                          ['Vitamins', scanResult.vitamins[0] ?? '—'],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-2xl bg-white px-3 py-2">
                            <div className="text-[10px] font-bold text-muted">{label}</div>
                            <div className="font-extrabold">{value}</div>
                          </div>
                        ))}
                      </div>
                      )}
                      {scanResult.verdict && <p className="mt-3 text-sm leading-relaxed text-slate-700">{scanResult.verdict}</p>}
                      <DietBadges codes={dietCodes({ name: scanResult.name, halal: scanResult.halal, contains: scanResult.contains })} label={t} />
                      <p className="mt-2 text-sm font-semibold text-slate-700">{smartSwapLine(scanResult)}</p>
                      {scanResult.model && <p className="mt-3 text-[10px] font-semibold tracking-tight text-muted">Verified by {scanResult.model}</p>}
                      <button
                        type="button"
                        className={`${primaryClass} mt-4 w-full`}
                        onClick={() => logMeal({ name: scanResult.name, calories: scanResult.calories, protein: scanResult.protein, carbs: scanResult.carbs, fats: scanResult.fat, score: scanResult.score ?? 0, advice: '' })}
                      >
                        {t('addToToday')}
                      </button>
                      <button type="button" className="mt-3 text-[11px] font-semibold text-muted underline" onClick={() => reportAi('scan', scanResult.name)}>Report inaccurate AI result</button>
                    </div>
                  )}
                </div>
              )}

              {aiTab === 'coach' && (
                <div className="card p-5">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-black tracking-[-0.03em]">{t('coach')}</h3>
                      <p className="text-xs text-muted">Live coach</p>
                    </div>
                    <button type="button" aria-label={t('clearChat')} className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold text-muted" onClick={clearChat}>
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                        <path d="M4 12a8 8 0 1 0 2.3-5.6" strokeLinecap="round" />
                        <path d="M4 4v4h4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {t('clearChat')}
                    </button>
                  </div>
                  <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                    {COACH_PROMPTS.map(([label, prompt]) => (
                      <button key={label} type="button" className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-extrabold text-slate-700" disabled={coachBusy} onClick={() => sendChat(prompt)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <div ref={chatRef} className="mb-3 max-h-80 space-y-2 overflow-y-auto pe-1">
                    {store.chat.map((message) => {
                      const live = coachLive !== null && coachLive.id === message.id ? coachLive : null;
                      const typing = live !== null && live.text === '';
                      const shown = live ? live.text : message.text === 'Generating...' ? t('generating') : message.text;
                      return (
                        <div key={message.id} className={message.sender === 'user' ? 'text-end' : 'text-start'}>
                          <span className={`inline-block max-w-[90%] rounded-3xl px-3.5 py-2.5 text-start text-sm leading-relaxed ${message.sender === 'user' ? 'btn-primary on-gradient' : 'glass-quiet text-slate-700'}`}>
                            {typing ? <span className="typing-dots" role="status" aria-label={t('generating')}><i /><i /><i /></span> : shown}
                          </span>
                          {message.sender === 'ai' && !live && message.text !== 'Generating...' && (
                            <button type="button" className="mt-1 block text-[10px] font-semibold text-muted underline" onClick={() => reportAi('coach', message.text)}>Report</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <form className="flex gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); sendChat(); }}>
                    <input className={fieldClass} value={chatInput} placeholder={t('coachPlaceholder')} disabled={coachBusy} onChange={(e) => setChatInput(e.target.value)} />
                    <MicButton hot={voiceFor === 'coach'} phase={voicePhase} label="Dictate a question" disabled={coachBusy || (voiceFor !== null && voiceFor !== 'coach')} onClick={() => dictate('coach', setChatInput)} />
                    <button type="submit" className={primaryClass} disabled={coachBusy}>{coachBusy ? '…' : 'Send'}</button>
                  </form>
                  {voiceFor === 'coach' && voiceNote && <p className="mt-2 text-sm font-semibold text-slate-700">{voiceNote}</p>}
                </div>
              )}
              <p className="mt-4 px-1 text-center text-[11px] leading-snug text-muted">{t('scanCaption')}</p>
            </section>
          )}

          {activeTab === 'sport' && (
            <section className="tab-scroll">
              <p className="mb-3 text-sm text-muted">{store.gpsAllowed ? 'Location allowed on this device.' : 'Location is requested each time you start.'}</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { name: 'Run', accent: '#ff2d55', tint: '#fff1f4', mark: 'M13 6.2a1.4 1.4 0 1 0 .1-2.8 1.4 1.4 0 0 0-.1 2.8zM5 20l3.2-4.6 1.8 1.6 2.6-3.4 1.7 1.5M8.2 10.2l2 2.2 2.4-2.6 2.6 1.8' },
                  { name: 'Hike', accent: '#22c55e', tint: '#f0fdf4', mark: 'M4 18l5-8 3 4 3-5 5 9' },
                  { name: 'Bike', accent: '#0ea5e9', tint: '#f0f9ff', mark: 'M6 16a3 3 0 1 0 .1 0M18 16a3 3 0 1 0 .1 0M6 16l4-7h4l3 4h4' },
                  { name: 'Walk', accent: '#f59e0b', tint: '#fffbeb', mark: 'M13 5.5a1.3 1.3 0 1 0 .1-2.6 1.3 1.3 0 0 0-.1 2.6zM9 20l2-5 2 2 2-3M10 10l2 2 3-2' },
                ].map((sport) => {
                  const liveCard = workoutOn && selectedSport === sport.name;
                  const kcalHr = Math.round((SPORTS[sport.name]?.met ?? 5) * store.weightKg);
                  return (
                    <button
                      key={sport.name}
                      type="button"
                      className="relative overflow-hidden rounded-[22px] border p-3.5 text-left shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
                      style={{ borderColor: liveCard ? sport.accent : `${sport.accent}55`, background: `linear-gradient(165deg, ${sport.tint}, #fff 62%)`, boxShadow: liveCard ? `0 0 0 2px ${sport.accent}` : undefined }}
                      onClick={() => startSport(sport.name)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="grid h-9 w-9 place-items-center rounded-2xl" style={{ background: `${sport.accent}18`, color: sport.accent }}>
                          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d={sport.mark} />
                          </svg>
                        </span>
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-extrabold" style={{ background: `${sport.accent}18`, color: sport.accent }}>{kcalHr} kcal/hr</span>
                      </div>
                      <div className="mt-4 text-lg font-black tracking-[-0.03em]">{sport.name}</div>
                      <div className="mt-0.5 text-[11px] font-bold" style={{ color: sport.accent }}>{liveCard ? 'Live now' : 'Start'}</div>
                    </button>
                  );
                })}
              </div>
              <button type="button" className={`${quietClass} mt-3 w-full`} onClick={() => startSport('Custom Workout')}>
                Build workout
              </button>

              <div className="card mt-4 p-5">
                <h3 className="text-lg font-black tracking-[-0.03em]">Pre & post workout</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted">Meals for the next 1–2 hours before you train, and the plate after, scaled to {formatWeight(store.weightKg, units, 0)}.</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {([
                    ['muscle', 'Muscle gain'],
                    ['fat', 'Fat loss'],
                  ] as const).map(([id, label]) => (
                    <button key={id} type="button" className={`h-10 rounded-full text-xs font-extrabold ${store.trainingGoal === id ? 'btn-primary on-gradient' : 'bg-slate-100 text-slate-600'}`} onClick={() => patch({ trainingGoal: id })}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(['Push', 'Pull', 'Legs'] as const).map((focus) => (
                    <button key={focus} type="button" className={`h-9 rounded-full text-xs font-extrabold ${store.sessionFocus === focus ? 'bg-slate-900 on-gradient' : 'bg-slate-100 text-slate-600'}`} onClick={() => patch({ sessionFocus: focus })}>
                      {focus}
                    </button>
                  ))}
                </div>
                {fuelBusy && <p className="mt-3 text-sm font-semibold text-slate-700">{t('buildingPlates')}</p>}
                <div className={`mt-4 rounded-2xl bg-slate-50 p-3 transition-opacity ${fuelBusy ? 'opacity-60' : ''}`}>
                  <div className="text-[11px] font-bold tracking-[0.14em] text-[#ff375f]">1–2 HOURS BEFORE</div>
                  <div className="mt-1 font-extrabold">{prePlate.title}</div>
                  <div className="mt-1 text-xs text-slate-600">{prePlate.items}</div>
                  {prePlate.calories != null && <div className="mt-2 text-[11px] font-extrabold text-slate-700">{prePlate.calories} kcal · P {prePlate.protein ?? 0}g · C {prePlate.carbs ?? 0}g · F {prePlate.fats ?? 0}g</div>}
                  <p className="mt-2 text-xs leading-relaxed text-muted">{prePlate.why}</p>
                </div>
                <div className={`mt-2 rounded-2xl bg-slate-50 p-3 transition-opacity ${fuelBusy ? 'opacity-60' : ''}`}>
                  <div className="text-[11px] font-bold tracking-[0.14em] text-[#22c55e]">AFTER TRAINING</div>
                  <div className="mt-1 font-extrabold">{postPlate.title}</div>
                  <div className="mt-1 text-xs text-slate-600">{postPlate.items}</div>
                  {postPlate.calories != null && <div className="mt-2 text-[11px] font-extrabold text-slate-700">{postPlate.calories} kcal · P {postPlate.protein ?? 0}g · C {postPlate.carbs ?? 0}g · F {postPlate.fats ?? 0}g</div>}
                  <p className="mt-2 text-xs leading-relaxed text-muted">{postPlate.why}</p>
                </div>
                <button type="button" className={`${quietClass} mt-3 w-full`} disabled={fuelBusy} onClick={() => { if (blockForQuota('kitchen')) return; setPlateCursor((n) => n + 1); }}>
                  {fuelBusy ? t('buildingPlates') : t('regenPlan')}
                </button>
              </div>

              <div className="card mt-4 p-5">
                <h3 className="text-lg font-black tracking-[-0.03em]">{t('strength')}</h3>
                <p className="mt-1 text-xs text-muted">Epley estimate from the weight you lifted and the reps you completed.</p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {LIFTS.map((name) => (
                    <button key={name} type="button" className={`h-10 rounded-2xl text-[11px] font-extrabold ${liftName === name ? 'btn-primary on-gradient' : 'bg-slate-100 text-slate-600'}`} onClick={() => setLiftName(name)}>
                      {name === 'Bench Press' ? 'Bench' : name}
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="text-xs font-semibold text-muted">
                    {t('weight')} ({weightUnit(units)})
                    <input className={`${fieldClass} mt-1`} inputMode="decimal" value={liftWeight} onChange={(e) => setLiftWeight(e.target.value)} />
                  </label>
                  <label className="text-xs font-semibold text-muted">
                    {t('reps')}
                    <input className={`${fieldClass} mt-1`} inputMode="numeric" value={liftReps} onChange={(e) => setLiftReps(e.target.value)} />
                  </label>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-3xl font-black tabular-nums tracking-[-0.04em]" dir="ltr">{previewRm !== null ? formatLiftWeight(previewRm, units) : '—'}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold tracking-[0.14em] text-muted">1RM</span>
                </div>
                <button type="button" className={`${primaryClass} mt-3 w-full`} onClick={saveLift}>{t('saveSet')}</button>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {bestLifts.map((item) => (
                    <div key={item.name} className="rounded-2xl bg-slate-50 px-1 py-2">
                      <div className="text-[10px] font-bold text-muted">{item.name === 'Bench Press' ? 'Bench' : item.name}</div>
                      <div className="mt-1 text-sm font-black tabular-nums">{item.best ? formatLiftWeight(item.best, units) : '—'}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card mt-4 p-5">
                <h3 className="text-lg font-black tracking-[-0.03em]">{t('recovery')}</h3>
                {store.workouts.length === 0 ? (
                  <p className="mt-2 text-sm font-semibold text-muted">{t('logWorkout')}</p>
                ) : (
                  <p className="mt-1 text-xs text-muted">Runs, walks, rides, and hikes update Legs. A saved Build workout updates the muscles in that session.</p>
                )}
                <div className="mt-3 flex flex-col gap-2">
                  {MUSCLES.map((group) => {
                    const status = recoveryFor(group, store.workouts);
                    return (
                      <div key={group} className="rounded-2xl bg-slate-50 px-3 py-3">
                        <div className="text-sm font-extrabold leading-snug" style={{ color: status.ready ? '#047857' : '#9a3412' }}>{status.line.replace('100% Ready', `${status.pct}% ${t('ready')}`).replace('Recovery Needed', t('recoveryNeeded')).replace(group, t(group === 'Chest' ? 'chest' : group === 'Back' ? 'back' : group === 'Legs' ? 'legs' : group === 'Shoulders' ? 'shoulders' : 'arms'))}</div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full rounded-full" style={{ width: `${status.pct}%`, background: status.ready ? '#22c55e' : '#f59e0b' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {music}
              {workoutOn && live && selectedSport && (
                <div className="card mt-4 p-6 text-center">
                  <div className="flex items-center justify-center gap-2 text-xs font-bold tracking-[0.16em] text-[#ff375f]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#ff375f]" />
                    LIVE · {selectedSport.toUpperCase()}
                  </div>
                  <div className="mt-2 text-5xl font-black tabular-nums tracking-[-0.05em]">{formatTime(workoutSec)}</div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div className="glass-quiet rounded-2xl py-3">
                      <div className="text-[11px] text-white/40">Distance</div>
                      <div className="mt-1 font-semibold tabular-nums">{formatDistance(live.distanceKm)}</div>
                    </div>
                    <div className="glass-quiet rounded-2xl py-3">
                      <div className="text-[11px] text-white/40">Burn</div>
                      <div className="mt-1 font-semibold tabular-nums">{live.calories.toFixed(1)} kcal</div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-white/40">{gpsLabel}</div>
                  <button type="button" className={`${primaryClass} mt-4 w-full`} onClick={stopWorkout}>
                    Stop & save
                  </button>
                </div>
              )}
              {store.workouts.length > 0 && (
                <div className="mt-4">
                  <h3 className="mb-2 text-sm font-semibold text-white/70">Saved</h3>
                  {store.workouts.map((workout) => (
                    <div key={workout.id} className="glass-quiet mb-2 flex items-center justify-between rounded-2xl px-4 py-3 text-sm">
                      <span>{workout.sport}</span>
                      <span className="text-white/50 tabular-nums">{formatDistance(workout.distanceKm)} · {Math.round(workout.calories)} kcal</span>
                    </div>
                  ))}
                </div>
              )}
              {showGps && (
                <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-5 backdrop-blur-md" onClick={() => setShowGps(false)}>
                  <div className="card w-full max-w-[360px] p-6" role="dialog" aria-modal="true" aria-labelledby="gps-title" onClick={(e) => e.stopPropagation()}>
                    <h2 id="gps-title" className="text-[22px] leading-snug font-black tracking-[-0.03em]">Allow FitBite Pro to track your location?</h2>
                    <p className="mt-3 text-sm leading-relaxed text-white/60">
                      FitBite uses location to track your {selectedSport?.toLowerCase() ?? 'workout'} distance, route, and pace.
                    </p>
                    <div className="mt-5 grid grid-cols-2 gap-2">
                      <button type="button" className={quietClass} onClick={() => setShowGps(false)}>Go back</button>
                      <button type="button" className={primaryClass} onClick={allowGps}>Allow</button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {activeTab === 'me' && (
            <section className="tab-scroll">
              <div className="card mb-4 flex items-center justify-between p-5">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 truncate text-xl font-black tracking-[-0.03em]">{store.userName}{isPro && <span className="on-gradient rounded-full bg-[#0f1115] px-2 py-0.5 text-[10px] font-extrabold tracking-[0.14em]">PRO</span>}</h2>
                  <p className="mt-1 flex items-center gap-2 text-xs text-muted">
                    <span className="truncate">{emailOk(store.userEmail) ? store.userEmail : 'Add email in Profile'}</span>
                    {emailOk(store.userEmail) && <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-extrabold text-[#15803d]">Verified</span>}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {store.gender} · {formatHeightUnits(store.heightCm, units)} · {formatWeight(store.weightKg, units)} · BMI {bmiOf(store.weightKg, store.heightCm).toFixed(1)}
                  </p>
                  {store.session && emailOk(store.userEmail) && <p className="mt-1 text-xs text-muted">{PROVIDERS[store.session.provider].label}{store.paymentLabel ? ` · ${store.paymentLabel}` : ''}</p>}
                </div>
                <button type="button" className={quietClass} onClick={() => patch({ flowStep: 'profile' })}>{t('edit')}</button>
              </div>
              <div className="card-quiet mb-3 p-3">
                <p className="text-[11px] font-bold tracking-[0.14em] text-muted">{t('language')}</p>
                <div className="chip-row mt-2">
                  {LANGS.map((code) => (
                    <button key={code} type="button" className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-extrabold ${lang === code ? 'btn-primary on-gradient' : 'bg-slate-100 text-slate-600'}`} aria-pressed={lang === code} onClick={() => chooseLang(code)}>{languageName(code)}</button>
                  ))}
                </div>
                <p className="mt-3 text-[11px] font-bold tracking-[0.14em] text-muted">{t('settingsUnits')}</p>
                <div className="mt-2 grid grid-cols-2 gap-1.5 rounded-full bg-slate-100 p-1" role="group" aria-label={t('settingsUnits')}>
                  {(['metric', 'imperial'] as const).map((system) => (
                    <button key={system} type="button" aria-pressed={units === system} className={`h-9 rounded-full text-[12px] font-extrabold ${units === system ? 'btn-primary on-gradient' : 'text-slate-600'}`} onClick={() => chooseUnits(system)}>
                      {system === 'metric' ? t('unitMetric') : t('unitImperial')}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 px-1 text-[10px] font-semibold text-muted">{t('unitsHint')}</p>
              </div>
              <button type="button" className="mb-3 flex w-full items-center justify-between rounded-full bg-white px-4 py-2 text-left text-xs font-extrabold shadow-[0_8px_20px_rgba(15,23,42,0.05)]" onClick={openSubscription}>
                <span>{pro ? t('proActive') : t('proBanner')}</span>
                <span className="text-muted">{t('plans')}</span>
              </button>
              <div className="card mb-4 overflow-hidden">
                {([
                  ['account', t('menuAccount'), 'cloud'],
                  ['body', t('menuBody'), 'user'],
                  ['alerts', t('menuAlerts'), 'bell'],
                  ['sensor', t('menuSensors'), 'activity'],
                  ['privacy', t('menuPrivacy'), 'shield'],
                  ['feedback', t('menuSupport'), 'message'],
                  ['update', t('menuUpdate'), 'download'],
                  ['about', t('menuAbout'), 'info'],
                ] as const).map(([id, label, icon]) => (
                  <button key={id} type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setDesk(id)}>
                    <span className="on-gradient grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-[#0F1115]">
                      <DeskIcon name={icon} />
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-extrabold tracking-[-0.02em]">{label}</span>
                    <span className="rtl-flip text-muted" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>

              <div className="mb-2 flex items-end justify-between">
                <h2 className="text-lg font-black tracking-[-0.03em]">{t('watchHub')}</h2>
                <span className="text-xs text-muted">{t('livePulse')}</span>
              </div>
              <button type="button" className={`${primaryClass} mb-3 w-full`} onClick={() => void scanAnyWatch()}>
                {t('scanPair')}
              </button>
              {[
                ...WATCHES.map((watch) => ({ id: watch.id, name: watch.name, model: watch.model, battery: store.batteries[watch.id], custom: false as const })),
                ...store.customWatches.map((watch) => ({ id: watch.id, name: watch.name, model: watch.brand, battery: watch.battery, custom: true as const, mac: watch.mac })),
              ].sort((a, b) => (a.id === store.connectedWatch ? -1 : b.id === store.connectedWatch ? 1 : 0)).map((watch) => {
                const mac = 'mac' in watch ? watch.mac : undefined;
                const native = Boolean(nativeBle() && mac);
                const link = mac && bleLink?.mac === mac ? bleLink : null;
                const connected = store.connectedWatch === watch.id;
                const active = native ? Boolean(link && link.state !== 'disconnected') : connected;
                const paired = connected || watch.custom;
                const live = active && (native ? link?.state === 'live' : true) && watchStreaming;
                const alert = store.wristAlerts.find((item) => item.device === watch.id);
                const badge = native
                  ? link?.state === 'connecting' ? 'Connecting…'
                    : link?.state === 'connected' ? 'Connected · Setting up'
                    : link?.state === 'live' ? 'Connected · Live BLE'
                    : link?.state === 'noHr' ? (link.reason === 'no-0x180d' ? 'Connected · Watch uses proprietary HR protocol' : 'Connected · No heart-rate stream')
                    : link?.state === 'classic' ? 'Connected · Classic Only'
                    : 'Disconnected'
                  : connected ? (watchStreaming ? 'Connected · Live BLE' : 'Paired · waiting for heart rate')
                  : paired ? 'Disconnected' : 'Not paired';
                const detail = native && link?.state === 'noHr' && link.reason === 'no-0x180d' ? 'Wrist notifications and step tracking keep working.'
                  : native && link?.state === 'noHr' ? 'Heart-rate stream could not start. Tap Disconnect, then Reconnect.'
                  : native && link?.state === 'classic' ? 'Classic Bluetooth only: notifications and steps work, live BPM needs BLE'
                  : native && link?.state === 'live' && !watchStreaming ? 'Waiting for a heart-rate reading. Keep the watch snug on your wrist.'
                  : native && !active && link?.reason && link.reason !== 'user' ? bleReasonText(link.reason)
                  : null;
                return (
                  <article
                    key={watch.id}
                    className={`relative mb-4 overflow-hidden p-5 text-left ${active ? 'card' : 'card-quiet'}`}
                  >
                    <div className={`pointer-events-none absolute -top-10 -left-6 h-28 w-28 rounded-full blur-2xl ${watch.id === 'apple' ? 'bg-[#ff375f]/25' : watch.id === 'samsung' ? 'bg-[#f59e0b]/25' : 'bg-[#22c55e]/25'}`} />
                    <div className="relative z-10 flex items-center gap-3">
                      <WatchFace kind={watch.custom ? 'custom' : (watch.id as WatchId)} bpm={active ? heartRate : null} alert={active ? alert?.text ?? null : null} live={active} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-bold tracking-[0.16em] text-muted">{watch.model.toUpperCase()}</div>
                        <div className="truncate text-lg font-black tracking-[-0.03em]">{watch.name}</div>
                        {live ? (
                          <>
                            <div className="mt-1 flex items-center gap-1.5 text-xs font-extrabold text-[#16a34a]">
                              <span className="relative flex h-2 w-2">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22c55e] opacity-70" />
                                <span className="relative h-2 w-2 rounded-full bg-[#22c55e]" />
                              </span>
                              {badge}
                            </div>
                            <div className="mt-2 flex items-center gap-2 text-sm">
                              <span className="font-semibold tabular-nums">{heartRate}</span>
                              <span className="text-muted">BPM</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className={`mt-1 text-xs font-extrabold ${active ? 'text-[#16a34a]' : 'text-muted'}`}>{badge}</div>
                            <div className="mt-2 text-sm font-semibold tabular-nums">-- BPM</div>
                            {detail ? (
                              <p className="mt-1 text-[11px] leading-snug text-muted">{detail}</p>
                            ) : !paired ? (
                              <p className="mt-1 text-[11px] leading-snug text-muted">Tap Pair to sync live biometrics</p>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                    {active ? (
                      <>
                        <button type="button" className={`${primaryClass} mt-4 w-full`} onClick={sendWrist}>
                          Send wrist notification
                        </button>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <button type="button" className={`${quietClass} h-10 text-xs`} onClick={() => disconnectWatchNow({ mac })}>Disconnect</button>
                          <button type="button" className={`${quietClass} h-10 text-xs`} onClick={() => forgetWatch(watch.id)}>Forget</button>
                        </div>
                      </>
                    ) : paired ? (
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <button type="button" className={`${primaryClass} h-11 text-sm`} onClick={() => reconnectWatch({ name: watch.name, mac })}>Reconnect</button>
                        <button type="button" className={`${quietClass} h-11 text-sm`} onClick={() => forgetWatch(watch.id)}>Forget</button>
                      </div>
                    ) : (
                      <button type="button" className={`${quietClass} mt-4 w-full`} onClick={() => void scanAnyWatch()}>
                        Pair
                      </button>
                    )}
                  </article>
                );
              })}

              {store.wristAlerts.length > 0 && (
                <div className="card-quiet mb-4 p-5">
                  <h3 className="text-sm font-semibold">Wrist alerts</h3>
                  {uniqueAlerts(store.wristAlerts).map((alert) => (
                    <div key={alert.id} className="mt-3 border-t border-white/10 pt-3 text-xs text-white/60">
                      <span className="text-white/80">{alert.at}</span> · {(WATCHES.find((watch) => watch.id === alert.device) ?? store.customWatches.find((watch) => watch.id === alert.device))?.name} · {alert.text}
                    </div>
                  ))}
                </div>
              )}

              <div className="card-quiet mb-4 space-y-2 p-5 text-sm">
                <button type="button" className="flex w-full items-center justify-between py-1 text-start font-extrabold" onClick={() => setLegal('privacy')}>
                  <span>{t('privacyPolicy')}</span>
                  <span className="rtl-flip text-muted" aria-hidden="true">›</span>
                </button>
                <button type="button" className="flex w-full items-center justify-between py-1 text-start font-extrabold" onClick={() => setLegal('terms')}>
                  <span>{t('termsOfUse')}</span>
                  <span className="rtl-flip text-muted" aria-hidden="true">›</span>
                </button>
              </div>
              <div className="card mb-4 p-5">
                <h3 className="text-sm font-black">{t('deleteAccount')}</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted">{t('deleteBody')}</p>
                <button type="button" className="mt-3 h-11 w-full rounded-full bg-[#ffe4e6] text-sm font-extrabold text-[#be123c]" onClick={() => setShowDeleteConfirm(true)}>{t('deleteAccount')}</button>
              </div>
              <button type="button" className={`${quietClass} w-full`} onClick={() => { patch({ session: null, authProvider: null, flowStep: 'welcome' }); setActiveTab('today'); showToast('Signed out'); }}>
                {t('signOut')}
              </button>
            </section>
          )}

          {desk && (
            <div className="fixed inset-0 z-50 grid place-items-end bg-black/45 px-3 pb-6 backdrop-blur-md sm:place-items-center" onClick={() => setDesk(null)}>
              <div className="card max-h-[88dvh] w-full max-w-[390px] overflow-y-auto p-5" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-xl font-black tracking-[-0.03em]">
                    {desk === 'account' ? t('menuAccount') : desk === 'body' ? t('menuBody') : desk === 'alerts' ? t('menuAlerts') : desk === 'sensor' ? t('menuSensors') : desk === 'privacy' ? t('privacy') : desk === 'feedback' ? t('menuSupport') : desk === 'update' ? t('menuUpdate') : t('menuAbout')}
                  </h2>
                  <button type="button" className="grid h-9 w-9 place-items-center rounded-full text-lg text-slate-400" aria-label="Close" onClick={() => setDesk(null)}>✕</button>
                </div>
                {desk === 'account' && (
                  <div className="mt-4 space-y-3 text-sm">
                    <p className="font-extrabold">{store.userEmail || 'No email yet'}</p>
                    {emailOk(store.userEmail) && <span className="inline-flex rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-extrabold text-[#047857]">Verified</span>}
                    <p className="text-muted">{store.session ? `${PROVIDERS[store.session.provider].label} session on this device` : 'Not signed in'}</p>
                    <p className="text-muted">{pro ? 'FitBite Pro is active on this device.' : 'Basic AI Coach is free. Upgrade for scans, kitchen, and progress vision.'}</p>
                    <button type="button" className={`${primaryClass} w-full`} onClick={() => { setDesk(null); openPro(); }}>FitBite Pro</button>
                    {!store.session && <button type="button" className={`${quietClass} w-full`} onClick={() => patch({ flowStep: 'auth' })}>Sign in / Register</button>}
                  </div>
                )}
                {desk === 'body' && (
                  <div className="mt-4 space-y-2 text-sm">
                    <p className="text-[11px] font-bold tracking-[0.14em] text-muted">{t('dietTitle')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {DIET_FLAGS.map((flag) => (
                        <button key={flag} type="button" className={`rounded-full px-3 py-1.5 text-[11px] font-extrabold ${diet[flag] ? 'bg-[#dcfce7] text-[#047857]' : 'bg-slate-100 text-slate-600'}`} onClick={() => setDiet((current) => { const next = { ...current, [flag]: !current[flag] }; writeDiet(next); return next; })}>{t(flag)}</button>
                      ))}
                    </div>
                    <p className="font-extrabold">BMI {bmiOf(store.weightKg, store.heightCm).toFixed(1)} · {ageOf(store.birthday)} years</p>
                    <p className="text-muted">{formatHeightUnits(store.heightCm, units)} · {formatWeight(store.weightKg, units)} · {store.userEmail}</p>
                    <p className="text-muted">Daily targets · {CAL_GOAL} kcal · 150 g protein · 220 g carbs · 75 g fat · {formatWaterGoal(units)} water</p>
                    <button type="button" className={`${primaryClass} w-full`} onClick={() => { setDesk(null); patch({ flowStep: 'profile' }); }}>Edit profile</button>
                  </div>
                )}
                {desk === 'alerts' && (
                  <div className="mt-4 space-y-2">
                    {([
                      ['meals', 'Meal reminders'],
                      ['water', 'Hydration alerts'],
                      ['watch', 'Watch vibration'],
                    ] as const).map(([key, label]) => (
                      <button key={key} type="button" className="flex w-full items-center justify-between rounded-2xl bg-slate-50 px-3 py-3 text-sm font-extrabold" onClick={() => setPrefs((current) => ({ ...current, [key]: !current[key] }))}>
                        <span>{label}</span>
                        <span className={prefs[key] ? 'text-[#047857]' : 'text-muted'}>{prefs[key] ? 'On' : 'Off'}</span>
                      </button>
                    ))}
                  </div>
                )}
                {desk === 'sensor' && (
                  <div className="mt-4 space-y-3 text-sm">
                    <p className="text-muted">Remembers the battery-saver choice. Heart rate appears only after a watch sends a real packet.</p>
                    <button type="button" className={`${prefs.background ? primaryClass : quietClass} w-full`} onClick={() => setPrefs((current) => ({ ...current, background: !current.background }))}>{prefs.background ? 'Background rhythm on' : 'Turn on sensor guard'}</button>
                  </div>
                )}
                {desk === 'privacy' && (
                  <div className="mt-4 space-y-2 text-sm">
                    <p className="text-[11px] font-bold tracking-[0.14em] text-muted">{t('privacy')}</p>
                    <p className="rounded-full bg-[#dcfce7] px-3 py-2 text-center text-[11px] font-extrabold text-[#047857]">{t('zeroAds')}</p>
                    <button type="button" className="flex w-full items-center justify-between rounded-2xl bg-slate-50 px-3 py-3 text-left font-extrabold" onClick={() => { const next = !aiConsent; setAiConsent(next); writeAiConsent(next); }}>
                      <span>{t('consent')}</span>
                      <span className={aiConsent ? 'text-[#047857]' : 'text-muted'}>{aiConsent ? 'On' : 'Off'}</span>
                    </button>
                    <p className="text-xs leading-relaxed text-muted">{t('consentHint')}</p>
                    <button type="button" className={`${quietClass} w-full`} onClick={() => {
                      const payload = { exportedAt: new Date().toISOString(), profile: { name: store.userName, email: store.userEmail, gender: store.gender, heightCm: store.heightCm, weightKg: store.weightKg }, meals: store.meals, waterL: store.waterL, workouts: store.workouts, fasting: { active: store.isFasting, startedAt: store.fastingStartedAt } };
                      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                      const file = new File([blob], 'fitbite-pro-data.json', { type: 'application/json' });
                      const download = () => {
                        const link = document.createElement('a');
                        link.href = URL.createObjectURL(blob);
                        link.download = 'fitbite-pro-data.json';
                        link.click();
                        window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
                      };
                      if (navigator.share) {
                        void navigator.share({ files: [file], title: 'FitBite Pro' }).catch(download);
                      } else download();
                    }}>{t('exportData')}</button>
                    <p className="text-muted">{prefs.vault ? 'AES-256-GCM vault is on for this device.' : 'Records stay as local JSON until you turn the vault on.'}</p>
                    {([
                      ['vault', prefs.vault ? 'AES-256 vault on' : 'Turn on AES-256 vault'],
                      ['appleHealth', prefs.appleHealth ? 'Phone health data allowed' : 'Allow phone health data'],
                      ['googleHealth', prefs.googleHealth ? 'On-device health summary on' : 'Keep an on-device health summary'],
                      ['appLock', prefs.appLock ? 'App lock on' : 'Turn on PIN app lock'],
                    ] as const).map(([key, label]) => (
                      <button key={key} type="button" className="flex w-full items-center justify-between rounded-2xl bg-slate-50 px-3 py-3 text-left font-extrabold" onClick={() => {
                        if (key === 'appLock' && !prefs.appLock && pinDraft.length !== 4) {
                          showToast('Enter a 4-digit PIN first');
                          return;
                        }
                        if (key === 'appLock' && !prefs.appLock) {
                          void pinDigest(pinDraft).then((digest) => { setPrefs((current) => ({ ...current, appLock: true, pin: digest })); setPinDraft(''); setUnlocked(true); showToast('App lock is on'); });
                          return;
                        }
                        setPrefs((current) => ({ ...current, [key]: !current[key] }));
                      }}>{label}</button>
                    ))}
                    {!prefs.appLock && <input className={fieldClass} inputMode="numeric" maxLength={4} placeholder="4-digit PIN" value={pinDraft} onChange={(event) => setPinDraft(event.target.value.replace(/\D/g, '').slice(0, 4))} />}
                    <button type="button" className="block w-full py-2 text-start text-sm font-extrabold text-[#0f172a] underline" onClick={() => setLegal('privacy')}>{t('privacyPolicy')}</button>
                    <button type="button" className="block w-full py-2 text-start text-sm font-extrabold text-[#0f172a] underline" onClick={() => setLegal('terms')}>{t('termsOfUse')}</button>
                    <button type="button" className="h-11 w-full rounded-full bg-[#ffe4e6] text-sm font-extrabold text-[#be123c]" onClick={() => setShowDeleteConfirm(true)}>{t('deleteAccount')}</button>
                  </div>
                )}
                {desk === 'feedback' && (
                  <div className="mt-4 space-y-3">
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button key={star} type="button" className={`h-10 flex-1 rounded-full text-sm font-extrabold ${rating >= star ? 'btn-primary on-gradient' : 'bg-slate-100'}`} onClick={() => setRating(star)}>{star}</button>
                      ))}
                    </div>
                    <textarea className={`${fieldClass} min-h-24`} maxLength={400} placeholder="Tell the concierge what to improve" value={feedback} onChange={(event) => setFeedback(event.target.value)} />
                    <button type="button" className={`${primaryClass} w-full`} onClick={() => { if (!feedback.trim()) { showToast('Write a note first'); return; } setFeedbackSent(true); showToast('Feedback received'); }}>{feedbackSent ? 'Sent' : 'Send feedback'}</button>
                  </div>
                )}
                {desk === 'update' && (
                  <div className="mt-4 space-y-3 text-sm">
                    <p className="font-extrabold">FitBite Pro 1.0.0</p>
                    <p className="text-muted">{updateNote || 'Installed build 1.0.0.'}</p>
                  </div>
                )}
                {desk === 'about' && (
                  <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-700">
                    <p className="font-extrabold text-slate-950">FitBite Pro</p>
                    <p>Coach, Kitchen, and Scan run through the on-device app. Meals and messages stay on this phone.</p>
                    <p>{t('disclaimer')}</p>
                    <p>Security: optional AES-256-GCM local vault and a SHA-256 PIN. No card data is collected.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          <BarcodeScanModal open={barcodeOpen} onClose={() => setBarcodeOpen(false)} onCode={resolveBarcode} title={t('barcode')} manualLabel={t('manual')} photoLabel={t('scanPhoto')} cameraFallback={t('cameraOff')} closeLabel={t('close')} />

          {showDeleteConfirm && (
            <div className="fixed inset-0 z-[60] grid place-items-end bg-black/55 px-3 pb-6 backdrop-blur-md sm:place-items-center" onClick={() => setShowDeleteConfirm(false)}>
              <div className="card w-full max-w-[390px] p-5" role="dialog" aria-modal="true" aria-labelledby="delete-title" onClick={(event) => event.stopPropagation()}>
                <h2 id="delete-title" className="text-xl font-black tracking-[-0.03em]">{t('deleteTitle')}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">{t('deleteBody')}</p>
                <div className="mt-4 flex gap-2">
                  <button type="button" className={`${quietClass} flex-1`} onClick={() => setShowDeleteConfirm(false)}>{t('cancel')}</button>
                  <button type="button" className="h-11 flex-1 rounded-full bg-[#ffe4e6] text-sm font-extrabold text-[#be123c]" onClick={() => eraseLocalAccount()}>{t('deleteConfirm')}</button>
                </div>
              </div>
            </div>
          )}

          {showPaywall && (
            <ProPaywall
              t={t}
              locale={lang}
              isPro={isPro}
              reason={paywallReason}
              onClose={() => setShowPaywall(false)}
              onActivated={(_subscription, restored) => {
                patch({ proActive: true });
                showToast(restored ? t('pwRestored') : t('pwWelcome'));
                setShowPaywall(false);
              }}
              onEnded={() => {
                patch({ proActive: false });
                setShowPaywall(false);
              }}
              onLegal={(kind) => setLegal(kind)}
            />
          )}

          {legal && <LegalModal kind={legal} url={APP_LEGAL_URLS[legal]} t={t} onClose={() => setLegal(null)} />}

          {scanOpen && (
            <div className="fixed inset-0 z-50 grid place-items-end bg-black/55 px-3 pb-6 backdrop-blur-md sm:place-items-center" onClick={() => setScanOpen(false)}>
              <div className="card max-h-[88dvh] w-full max-w-[390px] overflow-y-auto p-5" role="dialog" aria-modal="true" aria-labelledby="scan-title" onClick={(event) => event.stopPropagation()}>
                <div className="flex items-start justify-between">
                  <div>
                    <h2 id="scan-title" className="text-xl font-black tracking-[-0.03em]">{nativeBle() ? 'Find your watch' : 'Scan any watch'}</h2>
                    {nativeBle() && <p className="mt-1 text-xs text-muted">{bleState === 'scanning' ? `Scanning… ${bleDevices.length} found` : 'Paired and nearby Bluetooth watches'}</p>}
                  </div>
                  <button type="button" className="grid h-9 w-9 place-items-center rounded-full text-lg text-slate-400" aria-label="Close scanner" onClick={() => setScanOpen(false)}>✕</button>
                </div>
                {nativeBle() ? (
                  <>
                    {bleState === 'scanning' && (
                      <div className="relative mx-auto mt-3 grid h-20 w-20 place-items-center" aria-hidden="true">
                        <span className="bt-ring absolute inset-1 rounded-full border-2 border-[#60a5fa]" />
                        <span className="bt-ring bt-ring-late absolute inset-1 rounded-full border-2 border-[#818cf8]" />
                        <span className="absolute inset-6 rounded-full bg-[#eef4ff]" />
                      </div>
                    )}
                    {bleNotice && (
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-sm leading-relaxed text-muted">{bleNotice.text}</p>
                        {bleNotice.actions.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {bleNotice.actions.map((action, index) => (
                              <button key={action.label} type="button" className={`${index === 0 ? primaryClass : quietClass} h-10 px-4 text-xs`} onClick={action.run}>{action.label}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {lastWatch && !bleNotice && (
                      <div className="mt-4 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-bold tracking-[0.14em] text-muted">LAST WATCH</div>
                          <div className="truncate text-sm font-extrabold tracking-[-0.02em]">{lastWatch.name}</div>
                        </div>
                        <button type="button" className={`${primaryClass} h-9 shrink-0 px-4 text-xs`} disabled={bleLink?.state === 'connecting'} onClick={() => reconnectWatch(lastWatch)}>
                          {bleLink?.state === 'connecting' && bleLink.mac === lastWatch.mac ? 'Connecting…' : 'Reconnect'}
                        </button>
                      </div>
                    )}
                    {!bleNotice && (
                      <div className="mt-3 space-y-2">
                        {bleDevices.map((device) => {
                          const busy = bleLink?.state === 'connecting' && bleLink.mac === device.mac;
                          const bars = signalBars(device.rssi);
                          return (
                            <div key={device.mac} className="toast-in flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-extrabold tracking-[-0.02em]">{device.name}</div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] font-bold text-muted">
                                  {device.bonded && <span className="rounded-full bg-slate-100 px-1.5 py-0.5">Paired in Android</span>}
                                  {device.hr && <span className="rounded-full bg-[#dcfce7] px-1.5 py-0.5 text-[#15803d]">Heart rate</span>}
                                  <span className="tabular-nums">{device.mac}</span>
                                  <span className="tabular-nums">{device.rssi !== null ? `${device.rssi} dBm` : 'Not in range'}</span>
                                </div>
                              </div>
                              <span className="flex h-4 items-end gap-[2px]" role="img" aria-label={`Signal ${bars} of 4`}>
                                {[1, 2, 3, 4].map((step) => (
                                  <span key={step} className="w-[3px] rounded-sm" style={{ height: 4 + step * 3, background: step <= bars ? '#16a34a' : '#cbd5e1' }} />
                                ))}
                              </span>
                              <button type="button" className={`${primaryClass} h-9 shrink-0 px-4 text-xs`} disabled={bleLink?.state === 'connecting'} onClick={() => connectScanned(device)}>
                                {busy ? (
                                  <>
                                    <span className="bt-spin h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white" />
                                    Connecting
                                  </>
                                ) : (
                                  'Connect'
                                )}
                              </button>
                            </div>
                          );
                        })}
                        {bleDevices.length === 0 && bleState !== 'scanning' && (
                          <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-muted">
                            No watches found nearby. Wake the watch, keep it within a metre, and close other apps that hold its Bluetooth link. Watches already paired in Android appear here as soon as you scan.
                          </p>
                        )}
                        {bleDevices.length === 0 && bleState === 'scanning' && (
                          <p className="px-1 text-center text-xs text-muted">Looking for watches. Keep the watch awake and close.</p>
                        )}
                      </div>
                    )}
                    {!bleNotice && bleState !== 'scanning' && (
                      <button type="button" className={`${quietClass} mt-4 w-full`} disabled={bleLink?.state === 'connecting'} onClick={() => void scanAnyWatch()}>Scan again</button>
                    )}
                  </>
                ) : (
                  <>
                    <div className="relative mx-auto mt-4 grid h-28 w-28 place-items-center" aria-hidden="true">
                      <span className="bt-ring absolute inset-1 rounded-full border-2 border-[#60a5fa]" />
                      <span className="bt-ring bt-ring-late absolute inset-1 rounded-full border-2 border-[#818cf8]" />
                      <span className="absolute inset-7 rounded-full bg-[#eef4ff]" />
                    </div>
                    <p className="mt-4 text-sm text-muted">Bluetooth is unavailable in this browser. Name the watch and it stays paired without a live heart rate until a 0x180D packet arrives.</p>
                    <div className="mt-3 flex gap-2">
                      <input className={fieldClass} placeholder="Custom watch name" value={customWatchName} maxLength={40} onChange={(e) => setCustomWatchName(e.target.value)} />
                      <button type="button" className={primaryClass} onClick={() => pairDiscoveredWatch(customWatchName, 'Custom')}>Pair</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {workoutOn && live && selectedSport && activeTab !== 'sport' && (
            <div className="fixed bottom-20 left-1/2 z-30 w-[min(398px,calc(100%-32px))] -translate-x-1/2">
              <div className="glass flex items-center justify-between gap-3 rounded-full px-4 py-3 text-xs">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setActiveTab('sport')}>
                  <span className="block font-semibold">{selectedSport}</span>
                  <span className="tabular-nums text-white/55">{formatTime(workoutSec)} · {formatDistance(live.distanceKm)} · {live.calories.toFixed(1)} kcal</span>
                </button>
                <button type="button" className="btn-workout rounded-full px-4 py-2 text-sm font-extrabold on-gradient" onClick={stopWorkout}>
                  Save
                </button>
              </div>
            </div>
          )}

          <nav className="dock fixed left-1/2 z-40 flex w-[min(398px,calc(100%-32px))] -translate-x-1/2 items-center justify-between rounded-full px-1.5 py-1.5" style={{ bottom: 'max(env(safe-area-inset-bottom), 1rem)', backdropFilter: 'blur(20px) saturate(1.5)', WebkitBackdropFilter: 'blur(20px) saturate(1.5)' }} aria-label="Primary">
            {([
              ['today', 'today', 'today'],
              ['health', 'health', 'health'],
              ['ai', 'ai', 'ai'],
              ['sport', 'sport', 'sport'],
              ['me', 'me', 'me'],
            ] as const).map(([id, label, icon]) => (
              <button key={id} type="button" className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-full px-0.5 py-1.5 text-[10px] leading-none font-extrabold tracking-tight whitespace-nowrap ${activeTab === id ? 'dock-pill on-gradient' : 'dock-idle'}`} onClick={() => setActiveTab(id)}>
                <Icon name={icon} className="h-[18px] w-[18px]" />
                <span className="max-w-full truncate">{t(label)}</span>
              </button>
            ))}
          </nav>
        </>
      )}
    </main>
  );
}
