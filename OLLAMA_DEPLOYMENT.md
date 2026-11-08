# Amicus + Ollama deployment notes

## Architecture

Browser -> Vercel `/api/chat` -> Supabase JWT verification -> Cloudflare Access
-> Cloudflare Tunnel -> Ollama on the VPS.

The browser never receives the Ollama address or Cloudflare service-token secret.
Do not publish port `11434` directly to the internet.

## Vercel environment variables

Add the values from `.env.example` in Vercel Project Settings -> Environment
Variables. Use the same Supabase project URL as the frontend and the Supabase
anon/publishable key. Do not use the Supabase service-role key.

`OLLAMA_BASE_URL` must be the HTTPS hostname protected by Cloudflare Access.
`OLLAMA_MODEL` must exactly match a model returned by `ollama list`.

## Cloudflare Tunnel and Access

1. Keep Ollama listening on `127.0.0.1:11434` on the VPS.
2. Create a Cloudflare Tunnel and route a hostname to `http://127.0.0.1:11434`.
3. Create a Cloudflare Access self-hosted application for that hostname.
4. Add a Service Auth policy for the application.
5. Create a Cloudflare Access service token.
6. Put its Client ID and Client Secret in Vercel as
   `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`.
7. Set `OLLAMA_BASE_URL` to the protected HTTPS hostname, without `/api/chat`.

The Vercel API sends the service-token headers. Do not put those values in
frontend variables or commit them to Git.

## Deploy and test

1. Deploy the branch to Vercel.
2. Sign in to Amicus and send a short test message.
3. In Vercel Logs, inspect `/api/chat` if the request fails.
4. Check that the configured model exists on the VPS with `ollama list`.

The current API streams Ollama's NDJSON response, matching the stream parser
already present in `App.tsx`.

## Legal research limitation

Qwen running locally does not automatically have live access to Kenya Law or
other legal databases. The revised system instruction tells Matt not to claim
that it searched or cite cases it cannot verify. A separate retrieval/search
integration is still needed for reliable current case-law research.
