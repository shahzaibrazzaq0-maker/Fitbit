import { GEMINI_MODEL, serverAsk, serverTranscribe, serverVision } from '@/lib/aiServer';

export { GEMINI_MODEL };

type AskBody = { op?: string; prompt?: string; jpeg?: string; tokens?: number; temperature?: number; audio?: string; mime?: string };

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
    const result = await serverVision(typeof body.prompt === 'string' ? body.prompt : '', typeof body.jpeg === 'string' ? body.jpeg : '');
    return json(result);
  }
  if (body.op === 'transcribe') {
    const result = await serverTranscribe(typeof body.audio === 'string' ? body.audio : '', typeof body.mime === 'string' ? body.mime : 'audio/webm');
    return json(result);
  }
  if (body.op === 'ask') {
    const tokens = typeof body.tokens === 'number' && Number.isFinite(body.tokens) ? Math.min(800, Math.max(32, Math.round(body.tokens))) : 160;
    const temperature = typeof body.temperature === 'number' && Number.isFinite(body.temperature) ? Math.min(1, Math.max(0, body.temperature)) : 0.3;
    const result = await serverAsk(typeof body.prompt === 'string' ? body.prompt.slice(0, 4000) : '', typeof body.jpeg === 'string' ? body.jpeg : undefined, tokens, temperature);
    return json(result);
  }
  return json({ error: 'Unrecognized request' }, 400);
}
