'use client';

import React, { useState, useEffect } from 'react';

const foodDatabase = [
  { name: 'Roti / Chapati (1 medium)', calories: 120, protein: 3, carbs: 22, fat: 2, tag: 'Desi' },
  { name: 'Daal Chawal (1 plate)', calories: 350, protein: 12, carbs: 55, fat: 8, tag: 'Desi' },
  { name: 'Chicken Tikka (200g)', calories: 280, protein: 35, carbs: 4, fat: 12, tag: 'High Protein' },
  { name: 'Boiled Eggs (2 whole)', calories: 140, protein: 12, carbs: 1, fat: 10, tag: 'Keto' },
  { name: 'Oats with Milk & Berries', calories: 260, protein: 9, carbs: 42, fat: 5, tag: 'Balanced' },
  { name: 'Whey Protein Shake', calories: 160, protein: 25, carbs: 6, fat: 3, tag: 'High Protein' },
  { name: 'Grilled Chicken Caesar', calories: 310, protein: 30, carbs: 12, fat: 14, tag: 'Keto' },
  { name: 'Chicken Biryani (1 plate)', calories: 480, protein: 22, carbs: 62, fat: 16, tag: 'Desi' },
];

const dietPlans: Record<string, { calories: number; protein: number; carbs: number; fats: number }> = {
  Balanced: { calories: 2200, protein: 140, carbs: 240, fats: 70 },
  'Weight Loss': { calories: 1750, protein: 150, carbs: 150, fats: 55 },
  'Muscle Gain': { calories: 2700, protein: 190, carbs: 310, fats: 75 },
  Keto: { calories: 1900, protein: 130, carbs: 35, fats: 135 },
};

export default function FitBiteLuxuryDashboard() {
  const [selectedPlan, setSelectedPlan] = useState<string>('Balanced');
  const targets = dietPlans[selectedPlan];

  // Load from LocalStorage if available
  const [caloriesConsumed, setCaloriesConsumed] = useState(1240);
  const [waterConsumed, setWaterConsumed] = useState(1300);
  const waterGoal = 3000;
  const [stepsCount, setStepsCount] = useState(6420);
  const stepsGoal = 10000;

  const [macros, setMacros] = useState({
    protein: 88,
    carbs: 135,
    fats: 41,
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [aiInput, setAiInput] = useState('');
  const [recentLogs, setRecentLogs] = useState([
    { name: 'Oatmeal & Berries', calories: 380, time: '7:15 AM', type: 'meal' },
    { name: 'Still Water (500ml)', calories: 0, time: '9:40 AM', type: 'water' },
    { name: 'Chicken Tikka (200g)', calories: 280, time: '1:30 PM', type: 'meal' },
  ]);

  // Load saved data on initial render
  useEffect(() => {
    const savedCalories = localStorage.getItem('fitbite_calories');
    const savedWater = localStorage.getItem('fitbite_water');
    const savedSteps = localStorage.getItem('fitbite_steps');
    const savedMacros = localStorage.getItem('fitbite_macros');
    const savedLogs = localStorage.getItem('fitbite_logs');
    const savedPlan = localStorage.getItem('fitbite_plan');

    if (savedCalories) setCaloriesConsumed(Number(savedCalories));
    if (savedWater) setWaterConsumed(Number(savedWater));
    if (savedSteps) setStepsCount(Number(savedSteps));
    if (savedMacros) setMacros(JSON.parse(savedMacros));
    if (savedLogs) setRecentLogs(JSON.parse(savedLogs));
    if (savedPlan) setSelectedPlan(savedPlan);
  }, []);

  // Save to LocalStorage whenever state changes
  useEffect(() => {
    localStorage.setItem('fitbite_calories', caloriesConsumed.toString());
    localStorage.setItem('fitbite_water', waterConsumed.toString());
    localStorage.setItem('fitbite_steps', stepsCount.toString());
    localStorage.setItem('fitbite_macros', JSON.stringify(macros));
    localStorage.setItem('fitbite_logs', JSON.stringify(recentLogs));
    localStorage.setItem('fitbite_plan', selectedPlan);
  }, [caloriesConsumed, waterConsumed, stepsCount, macros, recentLogs, selectedPlan]);

  const addFood = (food: { name: string; calories: number; protein: number; carbs: number; fat: number }) => {
    setCaloriesConsumed((prev) => prev + food.calories);
    setMacros((prev) => ({
      protein: prev.protein + food.protein,
      carbs: prev.carbs + food.carbs,
      fats: prev.fats + food.fat,
    }));
    setRecentLogs((prev) => [
      {
        name: food.name,
        calories: food.calories,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'meal',
      },
      ...prev,
    ]);
  };

  const handleAiQuickLog = (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiInput.trim()) return;

    const query = aiInput.toLowerCase();
    const matched = foodDatabase.find((item) =>
      item.name.toLowerCase().split(' ').some((word) => word.length > 3 && query.includes(word))
    );

    if (matched) {
      addFood(matched);
    } else {
      addFood({ name: aiInput, calories: 290, protein: 14, carbs: 32, fat: 10 });
    }
    setAiInput('');
  };

  const handleAddWater = (amount: number) => {
    setWaterConsumed((prev) => prev + amount);
    setRecentLogs((prev) => [
      {
        name: `Hydration (+${amount}ml)`,
        calories: 0,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'water',
      },
      ...prev,
    ]);
  };

  // Ring Calculations
  const calPct = Math.min(100, Math.round((caloriesConsumed / targets.calories) * 100));
  const waterPct = Math.min(100, Math.round((waterConsumed / waterGoal) * 100));
  const stepsPct = Math.min(100, Math.round((stepsCount / stepsGoal) * 100));

  const r1 = 84;
  const r2 = 64;
  const r3 = 44;
  const c1 = 2 * Math.PI * r1;
  const c2 = 2 * Math.PI * r2;
  const c3 = 2 * Math.PI * r3;

  return (
    <main className="min-h-screen bg-[#050811] text-white relative overflow-x-hidden font-sans selection:bg-emerald-500 selection:text-black">
      {/* Ambient Aurora Glow Orbs */}
      <div className="fixed top-[-120px] left-[-100px] w-[380px] h-[380px] bg-emerald-500/20 rounded-full blur-[130px] pointer-events-none" />
      <div className="fixed top-[280px] right-[-120px] w-[350px] h-[350px] bg-cyan-500/15 rounded-full blur-[130px] pointer-events-none" />
      <div className="fixed bottom-[-100px] left-[20%] w-[320px] h-[320px] bg-rose-500/10 rounded-full blur-[130px] pointer-events-none" />

      <div className="max-w-md mx-auto px-4 py-6 space-y-5 relative z-10 pb-16">
        {/* Top Luxury Header */}
        <header className="flex items-center justify-between bg-white/[0.04] backdrop-blur-2xl border border-white/[0.08] px-4 py-3.5 rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-600 p-[1px] shadow-[0_0_20px_rgba(16,185,129,0.4)]">
              <div className="w-full h-full bg-[#070b14] rounded-2xl flex items-center justify-center font-black text-sm tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 to-cyan-300">
                FB
              </div>
            </div>
            <div>
              <h1 className="font-bold text-base tracking-tight leading-none">FitBite</h1>
              <span className="text-[11px] text-emerald-400/90 font-medium tracking-wide">PRO NUTRITION</span>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-white/[0.05] border border-white/[0.08] px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-semibold text-slate-200">Saved State</span>
          </div>
        </header>

        {/* Diet Goal Switcher Pills */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
          {Object.keys(dietPlans).map((plan) => (
            <button
              key={plan}
              onClick={() => setSelectedPlan(plan)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-300 ${selectedPlan === plan
                ? 'bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 shadow-[0_0_20px_rgba(52,211,153,0.4)]'
                : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:bg-white/[0.08] hover:text-white'
                }`}
            >
              {plan}
            </button>
          ))}
        </div>

        {/* Hero Activity Rings Glass Card */}
        <section className="bg-gradient-to-b from-white/[0.07] to-white/[0.02] backdrop-blur-2xl border border-white/[0.1] p-6 rounded-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.6)] relative overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Today&apos;s Rings</span>
            <span className="text-xs text-slate-400 font-medium">
              {Math.max(0, targets.calories - caloriesConsumed)} kcal left
            </span>
          </div>

          {/* Multi-Layered Glowing SVG Rings */}
          <div className="relative flex items-center justify-center my-4">
            <svg className="w-52 h-52 -rotate-90 drop-shadow-[0_0_18px_rgba(16,185,129,0.25)]" viewBox="0 0 200 200">
              <defs>
                <linearGradient id="calGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#fb7185" />
                  <stop offset="100%" stopColor="#f97316" />
                </linearGradient>
                <linearGradient id="waterGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#38bdf8" />
                  <stop offset="100%" stopColor="#2dd4bf" />
                </linearGradient>
                <linearGradient id="stepGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#a3e635" />
                  <stop offset="100%" stopColor="#10b981" />
                </linearGradient>
              </defs>

              {/* Background Tracks */}
              <circle cx="100" cy="100" r={r1} stroke="rgba(255,255,255,0.06)" strokeWidth="13" fill="none" />
              <circle cx="100" cy="100" r={r2} stroke="rgba(255,255,255,0.06)" strokeWidth="13" fill="none" />
              <circle cx="100" cy="100" r={r3} stroke="rgba(255,255,255,0.06)" strokeWidth="13" fill="none" />

              {/* Active Rings */}
              <circle
                cx="100"
                cy="100"
                r={r1}
                stroke="url(#calGrad)"
                strokeWidth="13"
                strokeLinecap="round"
                fill="none"
                strokeDasharray={c1}
                strokeDashoffset={c1 - (c1 * calPct) / 100}
                className="transition-all duration-700 ease-out"
              />
              <circle
                cx="100"
                cy="100"
                r={r2}
                stroke="url(#waterGrad)"
                strokeWidth="13"
                strokeLinecap="round"
                fill="none"
                strokeDasharray={c2}
                strokeDashoffset={c2 - (c2 * waterPct) / 100}
                className="transition-all duration-700 ease-out"
              />
              <circle
                cx="100"
                cy="100"
                r={r3}
                stroke="url(#stepGrad)"
                strokeWidth="13"
                strokeLinecap="round"
                fill="none"
                strokeDasharray={c3}
                strokeDashoffset={c3 - (c3 * stepsPct) / 100}
                className="transition-all duration-700 ease-out"
              />
            </svg>

            {/* Center Metric */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-3xl font-black tracking-tight bg-gradient-to-b from-white to-slate-300 bg-clip-text text-transparent">
                {caloriesConsumed.toLocaleString()}
              </span>
              <span className="text-[10px] tracking-[0.25em] text-slate-400 font-bold uppercase mt-0.5">KCAL</span>
            </div>
          </div>

          {/* 3 Mini Metric Cards */}
          <div className="grid grid-cols-3 gap-2.5 mt-2">
            <div className="bg-black/30 border border-white/[0.06] rounded-2xl p-3">
              <div className="w-4 h-1 rounded-full bg-gradient-to-r from-rose-400 to-orange-400 mb-2" />
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Calories</p>
              <p className="text-sm font-bold mt-0.5">{caloriesConsumed}</p>
              <p className="text-[10px] text-slate-500">/ {targets.calories}</p>
            </div>

            <div className="bg-black/30 border border-white/[0.06] rounded-2xl p-3">
              <div className="w-4 h-1 rounded-full bg-gradient-to-r from-sky-400 to-teal-300 mb-2" />
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Water</p>
              <p className="text-sm font-bold mt-0.5">{(waterConsumed / 1000).toFixed(2)} L</p>
              <p className="text-[10px] text-slate-500">/ 3.0 L</p>
            </div>

            <div
              onClick={() => setStepsCount((s) => s + 500)}
              className="bg-black/30 border border-white/[0.06] rounded-2xl p-3 cursor-pointer hover:border-emerald-500/30 transition-colors"
              title="Tap to add 500 steps"
            >
              <div className="w-4 h-1 rounded-full bg-gradient-to-r from-lime-400 to-emerald-400 mb-2" />
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Steps</p>
              <p className="text-sm font-bold mt-0.5">{stepsCount.toLocaleString()}</p>
              <p className="text-[10px] text-slate-500">+500 tap</p>
            </div>
          </div>

          {/* Macro Breakdown Bars */}
          <div className="mt-5 pt-4 border-t border-white/[0.08] space-y-3">
            {[
              { label: 'Protein', val: macros.protein, max: targets.protein, color: 'from-emerald-400 to-teal-400', text: 'text-emerald-400' },
              { label: 'Carbs', val: macros.carbs, max: targets.carbs, color: 'from-sky-400 to-indigo-400', text: 'text-sky-400' },
              { label: 'Healthy Fats', val: macros.fats, max: targets.fats, color: 'from-amber-400 to-orange-400', text: 'text-amber-400' },
            ].map((m) => (
              <div key={m.label}>
                <div className="flex justify-between text-xs mb-1 font-medium">
                  <span className={m.text}>{m.label}</span>
                  <span className="text-slate-300">
                    {m.val}g <span className="text-slate-500">/ {m.max}g</span>
                  </span>
                </div>
                <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${m.color} transition-all duration-500`}
                    style={{ width: `${Math.min(100, (m.val / m.max) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Quick Hydration Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handleAddWater(250)}
            className="flex items-center justify-between bg-white/[0.04] hover:bg-sky-500/15 active:scale-[0.98] backdrop-blur-xl border border-white/[0.08] hover:border-sky-400/40 p-4 rounded-3xl transition-all duration-200 shadow-lg"
          >
            <div className="text-left">
              <p className="text-[11px] text-sky-400 font-semibold uppercase tracking-wider">Hydrate</p>
              <p className="text-base font-bold mt-0.5">+250 ml</p>
            </div>
            <span className="text-xl">💧</span>
          </button>

          <button
            onClick={() => handleAddWater(500)}
            className="flex items-center justify-between bg-white/[0.04] hover:bg-teal-500/15 active:scale-[0.98] backdrop-blur-xl border border-white/[0.08] hover:border-teal-400/40 p-4 rounded-3xl transition-all duration-200 shadow-lg"
          >
            <div className="text-left">
              <p className="text-[11px] text-teal-400 font-semibold uppercase tracking-wider">Bottle</p>
              <p className="text-base font-bold mt-0.5">+500 ml</p>
            </div>
            <span className="text-xl">🫗</span>
          </button>
        </div>

        {/* FitBite AI Smart Log */}
        <section className="bg-white/[0.04] backdrop-blur-2xl border border-white/[0.08] p-5 rounded-[28px] shadow-xl">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <span className="text-emerald-400">✦</span> FitBite AI Quick-Log
            </h3>
            <span className="text-[10px] text-slate-500">Natural Language</span>
          </div>
          <form onSubmit={handleAiQuickLog} className="flex gap-2">
            <input
              type="text"
              placeholder="e.g. 2 boiled eggs or daal chawal..."
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              className="flex-1 bg-black/40 border border-white/[0.08] rounded-2xl px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400/60 transition-colors"
            />
            <button
              type="submit"
              className="bg-gradient-to-r from-emerald-400 to-cyan-400 hover:opacity-90 active:scale-95 text-slate-950 font-bold px-5 py-3 rounded-2xl text-sm transition-all shadow-[0_0_20px_rgba(52,211,153,0.3)]"
            >
              Log
            </button>
          </form>
        </section>

        {/* Global & Desi Food Database */}
        <section className="bg-white/[0.04] backdrop-blur-2xl border border-white/[0.08] p-5 rounded-[28px] shadow-xl space-y-3.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Food Database</h3>
            <span className="text-[11px] text-emerald-400 font-medium">Global & Desi</span>
          </div>

          <input
            type="text"
            placeholder="Search roti, tikka, oats, biryani..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-black/40 border border-white/[0.08] rounded-2xl px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/60"
          />

          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {foodDatabase
              .filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
              .map((food, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.05] rounded-2xl transition-all"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-100">{food.name}</p>
                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-white/[0.07] text-slate-300 font-medium">
                        {food.tag}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {food.calories} kcal • P {food.protein}g • C {food.carbs}g • F {food.fat}g
                    </p>
                  </div>
                  <button
                    onClick={() => addFood(food)}
                    className="bg-white/[0.08] hover:bg-emerald-400 hover:text-slate-950 active:scale-95 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                  >
                    + Add
                  </button>
                </div>
              ))}
          </div>
        </section>

        {/* Activity Timeline */}
        <section className="bg-white/[0.04] backdrop-blur-2xl border border-white/[0.08] p-5 rounded-[28px] shadow-xl space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Today&apos;s Timeline</h3>
          <div className="space-y-2">
            {recentLogs.map((log, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3.5 bg-black/30 border border-white/[0.05] rounded-2xl"
              >
                <div className="flex items-center gap-3">
                  <span className="text-base">{log.type === 'water' ? '💧' : '🍽️'}</span>
                  <div>
                    <p className="text-sm font-medium text-slate-100">{log.name}</p>
                    <p className="text-[11px] text-slate-500">{log.time}</p>
                  </div>
                </div>
                <span className={`text-xs font-bold ${log.calories > 0 ? 'text-emerald-400' : 'text-sky-400'}`}>
                  {log.calories > 0 ? `+${log.calories} kcal` : 'Hydrated'}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}