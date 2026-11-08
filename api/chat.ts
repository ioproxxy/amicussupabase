
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
};

const {
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
  CF_ACCESS_CLIENT_ID,
  CF_ACCESS_CLIENT_SECRET,
} = process.env;

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN ||
  'https://amicussupabase-five.vercel.app';

const buckets = new Map<string, { count: number; reset: number }>();

function limited(ip: string): boolean {
  const now = Date.now();
  let bucket = buckets.get(ip);

  if (!bucket || now > bucket.reset) {
    buckets.set(ip, { count: 1, reset: now + 60000 });
    return false;
  }

  bucket.count++;
  return bucket.count > 10;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST required.' });
  }

  const origin = req.headers.origin;
  if (origin && origin !== ALLOWED_ORIGIN) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }

  const forwarded = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
    ?.split(',')[0]?.trim() || 'unknown';

  if (limited(ip)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Too many requests.' });
  }

  if (
    !OLLAMA_BASE_URL ||
    !OLLAMA_MODEL ||
    !CF_ACCESS_CLIENT_ID ||
    !CF_ACCESS_CLIENT_SECRET
  ) {
    return res.status(500).json({
      error: 'Server configuration incomplete.'
    });
  }

  if (!OLLAMA_BASE_URL.startsWith('https://')) {
    return res.status(500).json({
      error: 'OLLAMA_BASE_URL must use HTTPS.'
    });
  }

  try {
    const {
      systemInstruction = '',
      messages
    } = req.body ?? {};

    if (
      !Array.isArray(messages) ||
      messages.length < 1 ||
      messages.length > 20
    ) {
      return res.status(400).json({
        error: 'Messages must contain 1–20 items.'
      });
    }

    if (
      typeof systemInstruction !== 'string' ||
      systemInstruction.length > 8000
    ) {
      return res.status(400).json({
        error: 'Invalid system instruction.'
      });
    }

    let total = systemInstruction.length;

    const validMessages = messages.map((m: any) => {
      if (
        !m ||
        !['user', 'assistant'].includes(m.role) ||
        typeof m.content !== 'string' ||
        m.content.length < 1 ||
        m.content.length > 8000
      ) {
        throw new Error('Invalid message format.');
      }

      total += m.content.length;

      return {
        role: m.role,
        content: m.content
      };
    });

    if (total > 24000) {
      return res.status(413).json({
        error: 'Conversation too long.'
      });
    }

    if (
      validMessages[validMessages.length - 1].role !== 'user'
    ) {
      return res.status(400).json({
        error: 'Last message must be from the user.'
      });
    }

    const url =
      `${OLLAMA_BASE_URL.replace(/\/+$/, '')}/api/chat`;

    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
        'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: true,
        messages: [
          { role: 'system', content: systemInstruction },
          ...validMessages
        ],
        options: { num_predict: 512 }
      })
    });

    if (!upstream.ok) {
      console.error('Ollama error:', upstream.status);

      return res.status(502).json({
        error: 'Could not communicate with Ollama.',
        upstreamStatus: upstream.status
      });
    }

    if (!upstream.body) {
      return res.status(502).json({
        error: 'Empty Ollama response.'
      });
    }

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');

    const reader = upstream.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }

      return res.end();
    } finally {
      reader.releaseLock();
    }

  } catch (error: any) {
    console.error('Amicus API error:', error);

    if (!res.headersSent) {
      return res.status(400).json({
        error: error.message || 'Invalid request.'
      });
    }

    return res.end();
  }
}
