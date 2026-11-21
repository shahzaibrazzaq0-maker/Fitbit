export type UnitSystem = 'metric' | 'imperial';

export const UNITS_KEY = 'fitbite_units_v1';

const KG_PER_LB = 0.45359237;
const ML_PER_FL_OZ = 29.5735295625;
const CM_PER_IN = 2.54;

/** Metric goal is 3 L. The imperial goal is exactly 100 fl oz so the counter reads cleanly. */
export const WATER_GOAL_METRIC_L = 3;
export const WATER_GOAL_IMPERIAL_OZ = 100;

export function readUnits(): UnitSystem {
  if (typeof window === 'undefined') return 'metric';
  const saved = window.localStorage.getItem(UNITS_KEY);
  if (saved === 'metric' || saved === 'imperial') return saved;
  const locale = (typeof navigator !== 'undefined' ? navigator.language : '') || '';
  return /^en-US$|^en-LR$|^my(-|$)/i.test(locale) ? 'imperial' : 'metric';
}

export function writeUnits(units: UnitSystem) {
  window.localStorage.setItem(UNITS_KEY, units);
}

export const kgToLb = (kg: number) => kg / KG_PER_LB;
export const lbToKg = (lb: number) => lb * KG_PER_LB;
export const cmToIn = (cm: number) => cm / CM_PER_IN;
export const inToCm = (inches: number) => inches * CM_PER_IN;
export const litersToOz = (liters: number) => (liters * 1000) / ML_PER_FL_OZ;
export const ozToLiters = (oz: number) => (oz * ML_PER_FL_OZ) / 1000;

export function round(value: number, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function weightValue(kg: number, units: UnitSystem, digits = 1) {
  return units === 'imperial' ? round(kgToLb(kg), digits) : round(kg, digits);
}

export function weightUnit(units: UnitSystem) {
  return units === 'imperial' ? 'lbs' : 'kg';
}

export function formatWeight(kg: number, units: UnitSystem, digits = 1) {
  const value = weightValue(kg, units, digits);
  return `${digits > 0 ? value.toFixed(digits) : value} ${weightUnit(units)}`;
}

/** Lift weights read as whole numbers: "205 lbs" or "93 kg". Stored values stay in kg. */
export function formatLiftWeight(kg: number, units: UnitSystem) {
  return `${weightValue(kg, units, 0)} ${weightUnit(units)}`;
}

export function feetAndInches(cm: number) {
  const totalIn = Math.round(cmToIn(cm));
  return { feet: Math.floor(totalIn / 12), inches: totalIn % 12, totalIn };
}

export function formatHeightUnits(cm: number, units: UnitSystem) {
  if (units === 'metric') return `${Math.round(cm)} cm`;
  const { feet, inches } = feetAndInches(cm);
  return `${feet} ft ${inches} in`;
}

export function waterGoalL(units: UnitSystem) {
  return units === 'imperial' ? ozToLiters(WATER_GOAL_IMPERIAL_OZ) : WATER_GOAL_METRIC_L;
}

/** One tap on the water button: 250 ml or 8 fl oz. */
export function waterStepL(units: UnitSystem) {
  return units === 'imperial' ? ozToLiters(8) : 0.25;
}

export function waterStepLabel(units: UnitSystem) {
  return units === 'imperial' ? '8 oz' : '250 ml';
}

export function formatWater(liters: number, units: UnitSystem) {
  return units === 'imperial' ? `${Math.round(litersToOz(liters))} fl oz` : `${liters.toFixed(2)} L`;
}

export function formatWaterGoal(units: UnitSystem) {
  return units === 'imperial' ? `${WATER_GOAL_IMPERIAL_OZ} fl oz` : `${WATER_GOAL_METRIC_L.toFixed(2)} L`;
}

export function formatWaterAmount(liters: number, units: UnitSystem) {
  return units === 'imperial' ? `${Math.round(litersToOz(liters))} fl oz` : `${round(liters, 1).toFixed(1)} L`;
}

/** One line the AI receives so every answer uses the same measurement system. */
export function unitRuleLine(units: UnitSystem) {
  return units === 'imperial'
    ? 'Units: imperial. Give body weight in lb, height in ft and in, liquids in fl oz or cups, food weights in oz or lb, distance in miles. Do not use kg, cm, ml, or km.'
    : 'Units: metric. Give body weight in kg, height in cm, liquids in ml or L, food weights in g or kg, distance in km. Do not use lb, oz, or miles.';
}
