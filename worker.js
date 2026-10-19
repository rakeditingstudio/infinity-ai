/**
 * INFINITY AI — Cloudflare Worker backend
 * Project: rakeditingstudio/infinity-ai
 *
 * Configure API keys as Cloudflare Worker Secrets, never in index.html:
 * OPENAI_API_KEY (optional), GEMINI_API_KEY (optional), GROK_API_KEY (optional)
 *
 * API calls may incur provider charges. No provider is called until the user
 * sends a message. This worker uses OpenAI when configured, otherwise Gemini,
 * otherwise Grok. Set ALLOWED_ORIGIN to your deployed app origin if desired.
 */
const corsHeaders = (origin, allowedOrigin) => {
  const allow = allowedOrigin || origin || "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "";
    const headers = {
      ...corsHeaders(origin, allowedOrigin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };

    if (allowedOrigin && origin && origin !== allowedOrigin) {
      return new Response(JSON.stringify({ error: "Origin not allowed." }), {
        status: 403, headers
      });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({
        name: "INFINITY AI",
        brand: "Powered by RAK Editing Studio",
        status: "worker-online",
        chatEndpoint: "/api/chat"
      }, { headers });
    }

    if (request.method !== "POST" || url.pathname !== "/api/chat") {
      return Response.json({ error: "Not found." }, { status: 404, headers });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Please send valid JSON." }, { status: 400, headers });
    }

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return Response.json({ error: "Message is required." }, { status: 400, headers });
    }
    if (message.length > 4000) {
      return Response.json({ error: "Message is too long (maximum 4000 characters)." }, { status: 413, headers });
    }

    const systemPrompt = "You are INFINITY AI, a helpful, honest assistant. You can respond in the user's language, including Hindi and Hinglish. Do not claim capabilities or live access you do not have. Keep replies clear and safe.";
    const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
    const messages = [
      { role: "system", content: systemPrompt },
      ...history.filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map(m => ({ role: m.role, content: m.content.slice(0, 4000) })),
      { role: "user", content: message }
    ];

    try {
      // Provider priority: OpenAI, then Gemini, then Grok.
      if (env.OPENAI_API_KEY) {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + env.OPENAI_API_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: env.OPENAI_MODEL || "gpt-4.1-mini",
            messages,
            max_tokens: 800
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          return Response.json({ error: "OpenAI request failed. Check API key, model access, and billing settings.", provider: "openai" }, { status: 502, headers });
        }
        return Response.json({
          reply: data.choices?.[0]?.message?.content || "I couldn't generate a reply this time.",
          provider: "openai"
        }, { headers });
      }

      if (env.GEMINI_API_KEY) {
        const model = env.GEMINI_MODEL || "gemini-2.5-flash";
        const geminiContents = [
          ...history.filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
            .slice(-8).map(m => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content.slice(0, 4000) }]
            })),
          { role: "user", parts: [{ text: message }] }
        ];
        const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
          method: "POST",
          headers: {
            "x-goog-api-key": env.GEMINI_API_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: geminiContents,
            generationConfig: { maxOutputTokens: 800 }
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          return Response.json({ error: "Gemini request failed. Check API key, model access, and provider limits.", provider: "gemini" }, { status: 502, headers });
        }
        const reply = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "I couldn't generate a reply this time.";
        return Response.json({ reply, provider: "gemini" }, { headers });
      }

      if (env.GROK_API_KEY) {
        const response = await fetch("https://api.x.ai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + env.GROK_API_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: env.GROK_MODEL || "grok-3-mini",
            messages,
            max_tokens: 800
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          return Response.json({ error: "Grok request failed. Check API key, model access, and provider limits.", provider: "grok" }, { status: 502, headers });
        }
        return Response.json({
          reply: data.choices?.[0]?.message?.content || "I couldn't generate a reply this time.",
          provider: "grok"
        }, { headers });
      }

      return Response.json({
        error: "No AI provider configured yet. Add an API key as a Cloudflare Worker Secret first.",
        setup: ["OPENAI_API_KEY", "GEMINI_API_KEY", "GROK_API_KEY"]
      }, { status: 503, headers });
    } catch {
      return Response.json({ error: "Network error while contacting the AI provider. Please try again." }, { status: 502, headers });
    }
  }
};