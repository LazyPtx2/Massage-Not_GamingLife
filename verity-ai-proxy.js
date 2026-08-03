/**
 * Verity AI proxy — deploy this separately (NOT part of index.html).
 *
 * Why this file exists: an API key can never live in index.html or any
 * other code that ships to a visitor's browser — anyone can open dev
 * tools and steal it. This tiny server-side proxy holds the real key
 * and is the only thing Verity's page code talks to.
 *
 * ---- Deploy in about 5 minutes on Cloudflare Workers (free tier) ----
 * 1. Go to https://workers.cloudflare.com and sign up / log in.
 * 2. Create a new Worker, paste this whole file in as its code.
 * 3. In the Worker's Settings -> Variables, add an encrypted secret:
 *      name:  ANTHROPIC_API_KEY
 *      value: your key from https://console.anthropic.com
 * 4. Deploy. You'll get a URL like:
 *      https://verity-proxy.<your-subdomain>.workers.dev
 * 5. Open verity.js (or the matching block inside index.html) and set:
 *      var AI_ENDPOINT = "https://verity-proxy.<your-subdomain>.workers.dev";
 * 6. In allowedOrigin below, replace "*" with your actual site's URL
 *    once it's live, e.g. "https://yourname.example.com" — leaving it
 *    as "*" means any website could use your proxy/key, not just yours.
 *
 * Any provider works the same way (Vercel/Netlify/AWS Lambda functions,
 * etc.) — the shape is always: browser -> your server (holds the key)
 * -> Anthropic API -> back to browser. Never the browser directly.
 */

const allowedOrigin = "*"; // tighten this to your real domain before going live
const MODEL = "claude-sonnet-4-6";
const SYSTEM_PROMPT =
  "You are Verity, a friendly, concise assistant embedded as a chat " +
  "widget on a personal profile website. Keep replies short — under " +
  "60 words, casual tone, no markdown formatting since this renders " +
  "as plain text in a small chat bubble.";

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: cors });
    }

    let body;
    try {
      body = await request.json();
    } catch (err) {
      return json({ reply: null, error: "Bad request body" }, 400, cors);
    }

    const message = (body && typeof body.message === "string" ? body.message : "").slice(0, 500).trim();
    if (!message) {
      return json({ reply: "Say something first!" }, 200, cors);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return json({ reply: null, error: "Server misconfigured: missing API key" }, 500, cors);
    }

    try {
      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 300,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: message }],
        }),
      });

      if (!upstream.ok) {
        const errText = await upstream.text();
        return json({ reply: null, error: "Upstream error: " + errText.slice(0, 200) }, 502, cors);
      }

      const data = await upstream.json();
      const text = (data.content || [])
        .map((block) => (block && block.type === "text" ? block.text : ""))
        .join("")
        .trim();

      return json({ reply: text || "Sorry, I couldn't come up with anything for that." }, 200, cors);
    } catch (err) {
      return json({ reply: null, error: "Proxy error: " + String(err) }, 500, cors);
    }
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ "Content-Type": "application/json" }, cors),
  });
}
