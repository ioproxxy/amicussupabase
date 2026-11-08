
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '64kb',
    },
  },
};

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
  CF_ACCESS_CLIENT_ID,
  CF_ACCESS_CLIENT_SECRET,
} = process.env;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      error: 'Method not allowed. Use POST.',
    });
  }

  // Check required environment variables
  const required = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    CF_ACCESS_CLIENT_ID,
    CF_ACCESS_CLIENT_SECRET,
  };

  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    return res.status(500).json({
      error: 'Server configuration is incomplete.',
      missing,
    });
  }

  // Validate Ollama URL
  if (!OLLAMA_BASE_URL!.startsWith('https://')) {
    return res.status(500).json({
      error: 'OLLAMA_BASE_URL must use HTTPS.',
    });
  }

  try {
    // Validate Supabase JWT
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Authorization token required.',
      });
    }

    const token = authHeader.substring(7);

    const supabase = createClient(
      SUPABASE_URL!,
      SUPABASE_ANON_KEY!
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({
        error: 'Invalid or expired authentication token.',
      });
    }

    // Validate request body
    const {
      systemInstruction = '',
      messages,
    } = req.body ?? {};

    if (
      !Array.isArray(messages) ||
      messages.length === 0 ||
      messages.length > 50
    ) {
      return res.status(400).json({
        error: 'Messages must be an array containing 1–50 items.',
      });
    }

    const validMessages = messages.map((message: any) => {
      if (
        !message ||
        !['user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string' ||
        message.content.length > 16000
      ) {
        throw new Error('Invalid message format.');
      }

      return {
        role: message.role,
        content: message.content,
      };
    });

    if (validMessages[validMessages.length - 1].role !== 'user') {
      return res.status(400).json({
        error: 'The last message must be from the user.',
      });
    }

    if (
      typeof systemInstruction !== 'string' ||
      systemInstruction.length > 12000
    ) {
      return res.status(400).json({
        error: 'Invalid system instruction.',
      });
    }

    // Connect to Ollama through Cloudflare Access
    const ollamaUrl =
      `${OLLAMA_BASE_URL!.replace(/\/+$/, '')}/api/chat`;

    const ollamaResponse = await fetch(ollamaUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID!,
        'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET!,
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: true,
        messages: [
          {
            role: 'system',
            content: systemInstruction,
          },
          ...validMessages,
        ],
      }),
    });

    if (!ollamaResponse.ok) {
      const errorText = await ollamaResponse.text();

      console.error(
        'Ollama upstream error:',
        ollamaResponse.status,
        errorText
      );

      return res.status(502).json({
        error: 'Could not communicate with the Ollama server.',
        upstreamStatus: ollamaResponse.status,
      });
    }

    if (!ollamaResponse.body) {
      return res.status(502).json({
        error: 'Ollama returned an empty response.',
      });
    }

    // Stream Ollama response to the browser
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const reader = ollamaResponse.body.getReader();

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
      return res.status(500).json({
        error: error.message || 'Internal server error.',
      });
    }

    return res.end();
  }
}
