/**
 * Aurora ↔ Cloudflare proxy Worker
 * ---------------------------------
 * Cloudflare's AI APIs don't send CORS headers, so a static page (GitHub Pages,
 * file://) cannot call them directly. This tiny Worker fixes that — and keeps
 * your Cloudflare API token SERVER-SIDE (never in the browser).
 *
 * Deploy (~2 minutes, free tier):
 *   1. dash.cloudflare.com → Workers & Pages → Create Worker → paste this file.
 *   2. Settings → Variables → add SECRETS:
 *        CF_TOKEN      = your Cloudflare API token (Workers AI + AI Search read)
 *        CF_ACCOUNT_ID = your account id
 *      Optional vars:
 *        AI_SEARCH_INSTANCE = e.g. "mute-lake-1954"   (for /search)
 *        ALLOW_ORIGIN       = e.g. "https://you.github.io"  (default "*")
 *        PROXY_KEY          = optional shared secret; if set, callers must send
 *                             Authorization: Bearer <PROXY_KEY>
 *   3. In Aurora ⚙️ Settings → provider "Cloudflare" → Endpoint =
 *        https://<your-worker>.workers.dev/chat
 *      and (optionally) RAG URL = https://<your-worker>.workers.dev/search
 *
 * Routes:
 *   POST /chat    body: OpenAI-style {model, messages, stream, ...}
 *                 → AI Gateway Workers-AI OpenAI-compat endpoint (SSE streams through)
 *   POST /search  body: {messages:[{role:"user",content:"query"}]}
 *                 → AI Search hybrid retrieval (chunks with scores + urls)
 */

export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, content-type, x-title",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return new Response("POST only", { status: 405, headers: cors });

    if (env.PROXY_KEY) {
      const auth = req.headers.get("authorization") || "";
      if (auth !== `Bearer ${env.PROXY_KEY}`)
        return new Response(JSON.stringify({ error: "bad proxy key" }), { status: 401, headers: { ...cors, "content-type": "application/json" } });
    }

    const url = new URL(req.url);
    const body = await req.text();
    let upstream;

    if (url.pathname === "/chat") {
      // OpenAI-compatible chat via AI Gateway (streams SSE straight through).
      upstream = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/default/workers-ai/v1/chat/completions`;
    } else if (url.pathname === "/search") {
      upstream = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai-search/namespaces/default/instances/${env.AI_SEARCH_INSTANCE}/search`;
    } else {
      return new Response(JSON.stringify({ error: "unknown route (use /chat or /search)" }), { status: 404, headers: { ...cors, "content-type": "application/json" } });
    }

    const res = await fetch(upstream, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CF_TOKEN}`, "Content-Type": "application/json" },
      body,
    });

    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) h.set(k, v);
    return new Response(res.body, { status: res.status, headers: h });
  },
};
