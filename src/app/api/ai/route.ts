import { GEMINI_MODEL, TOKEN_CAPS, serverAsk, serverStream, serverTranscribe, serverVision, type StreamTurn } from '@/lib/aiServer';
import { unitRuleLine } from '@/lib/units';

export { GEMINI_MODEL };

type AskBody = { op?: string; kind?: string; system?: string; history?: unknown; prompt?: string; jpeg?: string; tokens?: number; temperature?: number; audio?: string; mime?: string; prefs?: unknown };

function cleanLine(value: unknown, max: number) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';
}

/** Language, diet, and unit rules from the app profile, added when the prompt does not already carry them. */
function withPreferences(prompt: string, prefs: unknown) {
  if (!prefs || typeof prefs !== 'object') return prompt;
  const { language, units, diet } = prefs as { language?: unknown; units?: unknown; diet?: unknown };
  const lines = [
    cleanLine(language, 80) ? `Reply in ${cleanLine(language, 80)}.` : '',
    cleanLine(diet, 700),
    units === 'imperial' || units === 'metric' ? unitRuleLine(units) : '',
  ].filter((line) => line && !prompt.includes(line));
  return lines.length ? `${lines.join('\n')}\n${prompt}` : prompt;
}

/** Last turns only: a long chat never rides along with a request. */
function cleanHistory(value: unknown): StreamTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row): StreamTurn | null => {
      if (!row || typeof row !== 'object') return null;
      const { role, text } = row as { role?: unknown; text?: unknown };
      const clean = cleanLine(text, 500);
      if (!clean || (role !== 'user' && role !== 'model')) return null;
      return { role, text: clean };
    })
    .filter((row): row is StreamTurn => row !== null)
    .slice(-8);
}

const COACH_SYSTEM = 'You are FitBite Pro’s coach. Reply in the user’s language. Direct and concise: at most 3 short sentences. General wellness only, never medical advice.';
const KITCHEN_SYSTEM = 'You are FitBite Pro’s kitchen. Follow the requested line format exactly. Short everyday recipes only.';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'x-ai-route',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  let body: AskBody;
  try {
    body = await request.json() as AskBody;
  } catch {
    return json({ error: 'Unrecognized request' }, 400);
  }
  if (body.op === 'vision') {
    const result = await serverVision(withPreferences(typeof body.prompt === 'string' ? body.prompt : '', body.prefs), typeof body.jpeg === 'string' ? body.jpeg : '');
    return json(result);
  }
  if (body.op === 'stream') {
    const kind = body.kind === 'kitchen' ? 'kitchen' : 'coach';
    const cap = TOKEN_CAPS[kind];
    const tokens = typeof body.tokens === 'number' && Number.isFinite(body.tokens) ? Math.min(cap, Math.max(32, Math.round(body.tokens))) : cap;
    const temperature = typeof body.temperature === 'number' && Number.isFinite(body.temperature) ? Math.min(1, Math.max(0, body.temperature)) : 0.3;
    const system = withPreferences(typeof body.system === 'string' && body.system.trim() ? body.system.slice(0, 3000) : (kind === 'kitchen' ? KITCHEN_SYSTEM : COACH_SYSTEM), body.prefs);
    const prompt = typeof body.prompt === 'string' ? body.prompt.slice(0, 1800) : '';
    if (!prompt.trim()) return json({ error: 'Unrecognized request' }, 400);
    const { stream, route } = await serverStream({ system, prompt, history: cleanHistory(body.history), tokens, temperature }, request.signal);
    return new Response(stream, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
        'x-ai-route': route,
      },
    });
  }
  if (body.op === 'transcribe') {
    const result = await serverTranscribe(typeof body.audio === 'string' ? body.audio : '', typeof body.mime === 'string' ? body.mime : 'audio/webm');
    return json(result);
  }
  if (body.op === 'ask') {
    const tokens = typeof body.tokens === 'number' && Number.isFinite(body.tokens) ? Math.min(800, Math.max(32, Math.round(body.tokens))) : 160;
    const temperature = typeof body.temperature === 'number' && Number.isFinite(body.temperature) ? Math.min(1, Math.max(0, body.temperature)) : 0.3;
    const result = await serverAsk(withPreferences(typeof body.prompt === 'string' ? body.prompt.slice(0, 4000) : '', body.prefs), typeof body.jpeg === 'string' ? body.jpeg : undefined, tokens, temperature);
    return json(result);
  }
  return json({ error: 'Unrecognized request' }, 400);
}
