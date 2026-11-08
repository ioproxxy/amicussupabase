
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '64kb',
    },
  },
};

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';

// Basic per-instance rate limiting.
const requests = new Map<string, { count: number; reset: number }>();
const RATE_LIMIT = 20;
const WINDOW_MS = 60_000;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!OLLAMA_BASE_URL) {
    return res.status(500).json({
      error: 'OLLAMA_BASE_URL is not configured in Vercel.',
    });
  }

  // Basic rate limit by client IP.
  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor?.split(',')[0]?.trim() || 'unknown';

  const now = Date.now();
  const bucket = requests.get(ip);

  if (bucket && bucket.reset > now && bucket.count >= RATE_LIMIT) {
    return res.status(429).json({
      error: 'Too many requests. Please try again shortly.',
    });
  }

  if (!bucket || bucket.reset <= now) {
    requests.set(ip, { count: 1, reset: now + WINDOW_MS });
  } else {
    bucket.count++;
  }

  try {
    const body = typeof req.body === 'string'
      ? JSON.parse(req.body)
      : req.body;

    const systemInstruction =
      typeof body?.systemInstruction === 'string'
        ? body.systemInstruction.slice(0, 8000)
        : '';

    const messages = body?.messages;

    if (
      !Array.isArray(messages) ||
      messages.length === 0 ||
      messages.length > 20
    ) {
      return res.status(400).json({
        error: 'Please provide between 1 and 20 messages.',
      });
    }

    const validMessages = messages.every(
      (message: any) =>
        message &&
        ['user', 'assistant'].includes(message.role) &&
        typeof message.content === 'string' &&
        message.content.length <= 8000
    );

    if (!validMessages) {
      return res.status(400).json({
        error: 'Invalid message format.',
      });
    }

    if (messages[messages.length - 1].role !== 'user') {
      return res.status(400).json({
        error: 'The last message must be from the user.',
      });
    }

    const ollamaMessages = [
      ...(systemInstruction
        ? [{ role: 'system', content: systemInstruction }]
        : []),
      ...messages.map((message: any) => ({
        role: message.role,
        content: message.content,
      })),
    ];

    const baseUrl = OLLAMA_BASE_URL.replace(/\/+$/, '');

    const ollamaResponse = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: ollamaMessages,
        stream: true,
      }),
      signal: AbortSignal.timeout(300000),
    });

    if (!ollamaResponse.ok) {
      const errorText = await ollamaResponse.text();

      console.error('Ollama error:', ollamaResponse.status, errorText);

      return res.status(502).json({
        error: 'The AI server returned an error.',
        status: ollamaResponse.status,
      });
    }

    if (!ollamaResponse.body) {
      return res.status(502).json({
        error: 'The AI server returned an empty response.',
      });
    }

    // Forward Ollama's NDJSON stream to the frontend.
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');

    const reader = ollamaResponse.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        res.write(Buffer.from(value));
      }

      res.end();
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    console.error('Amicus chat API error:', error);

    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Unable to connect to the AI server.',
      });
    }

    res.end();
  }
}
