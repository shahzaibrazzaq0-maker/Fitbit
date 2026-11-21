import { GEMINI_MODEL, serverAsk, serverTranscribe, serverVision } from '@/lib/aiServer';
import { unitRuleLine } from '@/lib/units';

export { GEMINI_MODEL };

type AskBody = { op?: string; prompt?: string; jpeg?: string; tokens?: number; temperature?: number; audio?: string; mime?: string; prefs?: unknown };

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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
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
