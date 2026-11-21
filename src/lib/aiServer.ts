import { parseScanNutrition } from '@/lib/aiEngine';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS = ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet'] as const;
export const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const TEXT_MODELS = [
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  { id: GEMINI_MODEL, label: 'Gemini 3.5 Flash Lite' },
] as const;
const VISION_CHAIN = [
  { kind: 'gemini' as const, id: GEMINI_MODEL, label: 'Gemini 3.5 Flash Lite' },
  { kind: 'openrouter' as const, id: 'inclusionai/ling-3.2-flash:free', label: 'Ling 3.2 Vision' },
  { kind: 'openrouter' as const, id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 Vision' },
];

function providerKeys() {
  return {
    gemini: process.env.GEMINI_API_KEY?.trim() || '',
    openrouter: process.env.OPENROUTER_API_KEY?.trim() || '',
  };
}

function scrub(value: string) {
  const { gemini, openrouter } = providerKeys();
  let next = value;
  if (openrouter) next = next.split(openrouter).join('');
  if (gemini) next = next.split(gemini).join('');
  return next.replace(/sk-or-[a-z0-9_-]+/gi, '').replace(/AQ\.[A-Za-z0-9_-]+/g, '');
}

function briefFailure(status: number, raw: string) {
  let detail = '';
  try {
    const data = JSON.parse(raw) as { error?: { message?: string; status?: string } | string };
    const message = typeof data.error === 'string' ? data.error : data.error?.message || data.error?.status || '';
    detail = scrub(message).replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  } catch {
    detail = '';
  }
  if (status === 402 || /credit/i.test(detail)) return 'HTTP 402 no credits';
  if (status === 429 || /rate limit/i.test(detail)) return 'HTTP 429 rate limit';
  if (status === 404) return 'HTTP 404 model unavailable';
  if (status === 503 || /high demand/i.test(detail)) return 'HTTP 503 high demand';
  if (status === 0) return 'network timeout';
  if (detail) return `HTTP ${status} ${detail.slice(0, 64)}`;
  return `HTTP ${status}`;
}

function geminiPartsText(parts: { text?: string; thought?: boolean }[] | undefined) {
  return scrub((parts ?? []).filter((part) => part.text && !part.thought).map((part) => part.text ?? '').join('')).trim();
}

function retryableReason(reason: string) {
  return /429|503|timeout|high demand|rate limit|network/i.test(reason);
}

function messageText(content: unknown) {
  if (typeof content === 'string') return scrub(content).trim();
  if (!Array.isArray(content)) return '';
  return scrub(content.map((part) => {
    if (typeof part === 'string') return part;
    if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return part.text;
    return '';
  }).join('')).trim();
}

let creditLeft: boolean | null = null;

async function paidVisionAllowed(openrouter: string) {
  if (!openrouter) return false;
  if (creditLeft !== null) return creditLeft;
  try {
    const response = await fetch('https://openrouter.ai/api/v1/credits', {
      headers: { Authorization: `Bearer ${openrouter}` },
      signal: AbortSignal.timeout(4000),
    });
    const data = await response.json() as { data?: { total_credits?: number; total_usage?: number } };
    creditLeft = (data.data?.total_credits ?? 0) - (data.data?.total_usage ?? 0) > 0;
  } catch {
    creditLeft = false;
  }
  return creditLeft;
}

async function postOpenRouterVision(model: string, prompt: string, jpeg: string, openrouter: string) {
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openrouter}`,
        'HTTP-Referer': 'https://fitbite.app',
        'X-Title': 'FitBite Pro',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg}` } },
          ],
        }],
        max_tokens: 360,
        temperature: 0.2,
        reasoning: { effort: 'none' },
      }),
    });
    const raw = await response.text();
    if (!response.ok) return { text: '', reason: briefFailure(response.status, raw) };
    const data = JSON.parse(raw) as { choices?: { message?: { content?: unknown } }[] };
    const text = messageText(data.choices?.[0]?.message?.content);
    return text ? { text, reason: '' } : { text: '', reason: 'empty vision reply' };
  } catch {
    return { text: '', reason: 'network timeout' };
  }
}

function geminiBody(parts: unknown[], tokens: number, temperature: number) {
  return JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      maxOutputTokens: tokens,
      temperature,
    },
  });
}

async function postGeminiVision(model: string, prompt: string, jpeg: string, gemini: string) {
  const body = geminiBody(
    [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: jpeg } }],
    1024,
    0.2,
  );
  let reason = 'network timeout';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(gemini)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000),
        body,
      });
      const raw = await response.text();
      if (!response.ok) {
        reason = briefFailure(response.status, raw);
        if (attempt === 0 && retryableReason(reason)) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          continue;
        }
        return { text: '', reason };
      }
      const data = JSON.parse(raw) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
      const text = geminiPartsText(data.candidates?.[0]?.content?.parts);
      return text ? { text, reason: '' } : { text: '', reason: 'empty vision reply' };
    } catch {
      reason = 'network timeout';
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        continue;
      }
    }
  }
  return { text: '', reason };
}

async function requestGemini(url: string, body: string, signal: AbortSignal) {
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal });
    if (!response.ok) return '';
    const data = JSON.parse(await response.text()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
    return geminiPartsText(data.candidates?.[0]?.content?.parts);
  } catch {
    return '';
  }
}

async function askOpenRouter(prompt: string, jpeg: string | undefined, tokens: number, temperature: number, openrouter: string) {
  if (!openrouter) return { text: '', label: '' };
  const content = jpeg
    ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg}` } }]
    : prompt;
  for (const model of OPENROUTER_MODELS) {
    try {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openrouter}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://fitbite.app',
          'X-Title': 'FitBite Pro',
        },
        signal: AbortSignal.timeout(6000),
        body: JSON.stringify({ model, messages: [{ role: 'user', content }], max_tokens: tokens, temperature }),
      });
      if (!response.ok) continue;
      const data = JSON.parse(await response.text()) as { choices?: { message?: { content?: unknown } }[] };
      const text = messageText(data.choices?.[0]?.message?.content);
      if (text) return { text, label: model.startsWith('anthropic/') ? 'Claude' : 'GPT-4o' };
    } catch {
      /* The next model, then Gemini, still answers. */
    }
  }
  return { text: '', label: '' };
}

async function askPollinations(prompt: string, tokens: number) {
  const response = await fetch('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ model: 'openai', messages: [{ role: 'user', content: prompt }], max_tokens: tokens }),
  });
  if (!response.ok) return '';
  const raw = await response.text();
  try {
    const data = JSON.parse(raw) as { choices?: { message?: { content?: unknown } }[] };
    return messageText(data.choices?.[0]?.message?.content);
  } catch {
    return scrub(raw).trim().slice(0, 700);
  }
}

export async function serverAsk(prompt: string, jpeg: string | undefined, tokens: number, temperature: number) {
  const { gemini, openrouter } = providerKeys();
  if (gemini && !jpeg) {
    const body = geminiBody([{ text: prompt }], tokens, temperature);
    for (const model of TEXT_MODELS) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${encodeURIComponent(gemini)}`;
      const text = await requestGemini(endpoint, body, AbortSignal.timeout(6000));
      if (text) return { text, route: model.label };
    }
  }
  const primary = await askOpenRouter(prompt, jpeg, tokens, temperature, openrouter);
  if (primary.text) return { text: primary.text, route: primary.label };
  if (gemini && jpeg) {
    const parts: ({ text: string } | { inlineData: { mimeType: 'image/jpeg'; data: string } })[] = [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: jpeg } }];
    const body = geminiBody(parts, tokens, temperature);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(gemini)}`;
    const text = await requestGemini(endpoint, body, AbortSignal.timeout(12000));
    if (text) return { text, route: 'Gemini 3.5 Flash Lite' };
  }
  if (jpeg) return { text: '', route: 'Unavailable' };
  try {
    const fused = await askPollinations(prompt, tokens);
    if (fused) return { text: fused, route: 'Fusion' };
  } catch {
    /* The on-device answer covers a quiet network. */
  }
  return { text: '', route: 'On-device' };
}

export async function serverVision(prompt: string, jpeg: string) {
  if (!jpeg || jpeg.length < 32) return { error: 'The photo was empty. Take another one.' };
  const { gemini, openrouter } = providerKeys();
  if (!gemini && !openrouter) return { error: 'Vision is not configured on the server.' };
  const chain = [...VISION_CHAIN];
  if (openrouter && await paidVisionAllowed(openrouter)) chain.push({ kind: 'openrouter' as const, id: 'openai/gpt-4o-mini', label: 'GPT-4o mini' });
  const reasons: string[] = [];
  for (const model of chain) {
    if (model.kind === 'gemini' && !gemini) continue;
    if (model.kind === 'openrouter' && !openrouter) continue;
    const result = model.kind === 'gemini'
      ? await postGeminiVision(model.id, prompt, jpeg, gemini)
      : await postOpenRouterVision(model.id, prompt, jpeg, openrouter);
    if (!result.text) {
      reasons.push(`${model.label} ${result.reason}`);
      continue;
    }
    try {
      return { card: { ...parseScanNutrition(result.text), model: model.label } };
    } catch {
      reasons.push(`${model.label} unreadable nutrition`);
    }
  }
  const reason = reasons[0] || 'no vision model responded';
  if (retryableReason(reason)) return { error: 'The vision service is busy. Tap the photo again in a moment.' };
  return { error: reason.slice(0, 180) };
}

export async function serverTranscribe(audioBase64: string, mimeType: string) {
  const data = audioBase64.trim();
  const { gemini } = providerKeys();
  if (data.length < 32 || !gemini) return { text: '' };
  const mime = (mimeType.split(';')[0] || 'audio/webm').trim();
  const body = geminiBody([
    { text: 'Transcribe this speech exactly. The speaker may use English, Arabic, German, French, Spanish, Italian, Urdu, or Roman Urdu. Return only the spoken words.' },
    { inlineData: { mimeType: mime, data } },
  ], 240, 0.1);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(gemini)}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = await requestGemini(endpoint, body, AbortSignal.timeout(20000));
    const spoken = text.replace(/^```[\s\S]*?\n/, '').replace(/```$/, '').replace(/^(transcript|transcription)\s*:\s*/i, '').trim();
    if (spoken) return { text: spoken.slice(0, 400) };
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return { text: '' };
}
