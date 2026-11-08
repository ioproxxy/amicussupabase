import { createClient } from '@supabase/supabase-js';

/**
 * Vercel serverless endpoint:
 * Browser -> this endpoint -> Cloudflare Access -> Cloudflare Tunnel -> Ollama.
 *
 * Required server-side environment variables:
 * SUPABASE_URL, SUPABASE_ANON_KEY, OLLAMA_BASE_URL, OLLAMA_MODEL,
 * CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET.
 *
 * Do not point OLLAMA_BASE_URL at a publicly exposed port 11434.
 */

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '64kb',
    },
  },
};

const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 12_000;
const MAX_SYSTEM_LENGTH = 16_000;

function sendError(res: any, status: number, message: string) {
  return res.status(status).json({ error: message });
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'Method not allowed');
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL;
  const ollamaModel = process.env.OLLAMA_MODEL;
  const accessClientId = process.env.CF_ACCESS_CLIENT_ID;
  const accessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;

  if (
    !supabaseUrl ||
    !supabaseAnonKey ||
    !ollamaBaseUrl ||
    !ollamaModel ||
    !accessClientId ||
    !accessClientSecret
  ) {
    return sendError(res, 500, 'Server configuration is incomplete.');
  }

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(ollamaBaseUrl);
  } catch {
    return sendError(res, 500, 'OLLAMA_BASE_URL must be a valid HTTPS URL.');
  }

  // Cloudflare Access protects the tunnel. Never send chat traffic to an
  // unauthenticated public Ollama endpoint.
  if (upstreamUrl.protocol !== 'https:') {
    return sendError(res, 500, 'OLLAMA_BASE_URL must use HTTPS.');
  }

  const authorization = req.headers.authorization;
  const match =
    typeof authorization === 'string'
      ? authorization.match(/^Bearer\s+(.+)$/i)
      : null;

  if (!match) {
    return sendError(res, 401, 'Please sign in to use the assistant.');
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser(
    match[1]
  );

  if (authError || !authData.user) {
    return sendError(res, 401, 'Your session is invalid or has expired.');
  }

  const body =
    typeof req.body === 'string'
      ? (() => {
          try {
            return JSON.parse(req.body);
          } catch {
            return null;
          }
        })()
      : req.body;

  if (!body || typeof body !== 'object') {
    return sendError(res, 400, 'A valid JSON request body is required.');
  }

  const systemInstruction = body.systemInstruction;
  const messages = body.messages;

  if (
    typeof systemInstruction !== 'string' ||
    systemInstruction.length === 0 ||
    systemInstruction.length > MAX_SYSTEM_LENGTH
  ) {
    return sendError(res, 400, 'The system instruction is missing or too long.');
  }

  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > MAX_MESSAGES
  ) {
    return sendError(res, 400, `Send between 1 and ${MAX_MESSAGES} messages.`);
  }

  const validMessages: Array<{ role: 'user' | 'assistant'; content: string }> =
    [];

  for (const message of messages) {
    if (
      !message ||
      !['user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string' ||
      message.content.trim().length === 0 ||
      message.content.length > MAX_MESSAGE_LENGTH
    ) {
      return sendError(res, 400, 'One or more chat messages are invalid.');
    }

    validMessages.push({
      role: message.role,
      content: message.content,
    });
  }

  if (validMessages[validMessages.length - 1].role !== 'user') {
    return sendError(res, 400, 'The last message must be from the user.');
  }

  const controller = new AbortController();

  req.on?.('aborted', () => controller.abort());
  res.on?.('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const upstream = await fetch(
      new URL('/api/chat', upstreamUrl).toString(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Access-Client-Id': accessClientId,
          'CF-Access-Client-Secret': accessClientSecret,
        },
        body: JSON.stringify({
          model: ollamaModel,
          stream: true,
          messages: [
            { role: 'system', content: systemInstruction },
            ...validMessages,
          ],
        }),
        signal: controller.signal,
      }
    );

    if (!upstream.ok) {
      const detail = (await upstream.text()).slice(0, 1500);
      console.error('Ollama gateway error:', upstream.status, detail);
      return sendError(res, 502, 'The AI server could not process the request.');
    }

    if (!upstream.body) {
      return sendError(res, 502, 'The AI server returned an empty response.');
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Accel-Buffering', 'no');

    const reader = upstream.body.getReader();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && !res.write(value)) {
        await new Promise<void>((resolve) => res.once('drain', resolve));
      }
    }

    return res.end();
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      if (!res.writableEnded) res.end();
      return;
    }

    console.error('Chat API error:', error);
    if (!res.headersSent) {
      return sendError(res, 502, 'Unable to reach the AI server. Please try again.');
    }
    if (!res.writableEnded) res.end();
  }
    }
  
