import "dotenv/config";
import express from "express";
import { createConnection } from "node:net";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { onShutdown } from "./bin/lib/platform.js";
import { config } from "./config.js";
import { startOAuthProxy } from "./lib/oauthLauncher.js";
import { getServerPort, listenWithPortFallback } from "./lib/runtimePorts.js";

function runtimeHostUrl(host) {
  if (!host || host === "0.0.0.0" || host === "::") return "localhost";
  return host;
}

async function isOAuthProxyReady(url) {
  try {
    const res = await fetch(`${url}/v1/models`, {
      signal: AbortSignal.timeout(config.oauth.statusTimeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function isTcpPortListening(port, host = "127.0.0.1") {
  return await new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function createTextFromResponse(json) {
  if (typeof json?.output_text === "string") return json.output_text;
  const chunks: string[] = [];
  for (const item of json?.output || []) {
    if (typeof item?.text === "string") chunks.push(item.text);
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") chunks.push(content.text);
      if (typeof content?.value === "string") chunks.push(content.value);
    }
  }
  return chunks.join("");
}

function responseInputFromTextBody(body: any) {
  if (body?.input !== undefined) return body.input;
  if (Array.isArray(body?.messages)) {
    return body.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }
  const input: any[] = [];
  if (typeof body?.developer === "string" && body.developer) {
    input.push({ role: "developer", content: body.developer });
  } else if (typeof body?.system === "string" && body.system) {
    input.push({ role: "developer", content: body.system });
  }
  input.push({ role: "user", content: String(body?.prompt ?? body?.text ?? "") });
  return input;
}

function buildTextResponseBody(body: any = {}) {
  const out: any = {
    model: body.model || config.llm.defaultModel,
    input: responseInputFromTextBody(body),
    stream: body.stream === true,
  };
  if (body.temperature !== undefined) out.temperature = body.temperature;
  if (body.top_p !== undefined) out.top_p = body.top_p;
  if (body.max_output_tokens !== undefined) out.max_output_tokens = body.max_output_tokens;
  if (body.reasoning !== undefined) out.reasoning = body.reasoning;
  else if (body.reasoningEffort !== undefined) out.reasoning = { effort: body.reasoningEffort };
  if (body.text !== undefined && typeof body.text === "object") out.text = body.text;
  return out;
}

function chatMessagesFromTextBody(body: any = {}) {
  if (Array.isArray(body.messages)) return body.messages;
  const messages: any[] = [];
  if (typeof body.developer === "string" && body.developer) {
    messages.push({ role: "system", content: body.developer });
  } else if (typeof body.system === "string" && body.system) {
    messages.push({ role: "system", content: body.system });
  }
  messages.push({ role: "user", content: String(body.prompt ?? body.text ?? "") });
  return messages;
}

function buildTextChatBody(body: any = {}) {
  const out: any = {
    model: body.model || config.llm.defaultModel,
    messages: chatMessagesFromTextBody(body),
    stream: body.stream === true,
  };
  if (body.temperature !== undefined) out.temperature = body.temperature;
  if (body.top_p !== undefined) out.top_p = body.top_p;
  if (body.max_tokens !== undefined) out.max_tokens = body.max_tokens;
  else if (body.max_output_tokens !== undefined) out.max_tokens = body.max_output_tokens;
  if (body.response_format !== undefined) out.response_format = body.response_format;
  return out;
}

function copyProxyHeaders(upstream, res) {
  for (const [key, value] of upstream.headers.entries()) {
    const lower = key.toLowerCase();
    if (["content-encoding", "content-length", "transfer-encoding", "connection"].includes(lower)) continue;
    res.setHeader(key, value);
  }
}

async function fetchOAuthJson(oauthUrl, path, body, timeoutMs = config.llm.timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(`${oauthUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: body?.stream ? "text/event-stream" : "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    return upstream;
  } finally {
    clearTimeout(timer);
  }
}

async function proxyJsonEndpoint(req, res, ctx, path) {
  try {
    const upstream = await fetchOAuthJson(ctx.oauthUrl, path, req.body);
    res.status(upstream.status);
    copyProxyHeaders(upstream, res);
    if (upstream.body) {
      Readable.fromWeb(upstream.body as any).pipe(res);
    } else {
      res.end();
    }
  } catch (err: any) {
    const aborted = err?.name === "AbortError";
    res.status(aborted ? 504 : 502).json({
      error: aborted ? "LLM OAuth request timed out" : "LLM OAuth request failed",
      code: aborted ? "LLM_OAUTH_TIMEOUT" : "LLM_OAUTH_FAILED",
      message: err?.message || String(err),
    });
  }
}

export function buildLlmApp(ctx) {
  const app = express();
  app.use(express.json({ limit: config.llm.bodyLimit }));

  app.get("/health", async (_req, res) => {
    const oauthLive = await isOAuthProxyReady(ctx.oauthUrl);
    if (oauthLive) ctx.oauthReadyState = "ready";
    res.json({
      ok: true,
      provider: "oauth",
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      llm: {
        configuredPort: config.llm.port,
        actualPort: ctx.llmActualPort || config.llm.port,
        url: ctx.llmUrl,
        defaultModel: config.llm.defaultModel,
      },
      oauth: {
        configuredPort: ctx.oauthPort,
        actualPort: ctx.oauthActualPort || ctx.oauthPort,
        url: ctx.oauthUrl,
        status: oauthLive ? "ready" : ctx.oauthReadyState,
      },
    });
  });

  app.get("/v1/models", async (_req, res) => {
    try {
      const upstream = await fetch(`${ctx.oauthUrl}/v1/models`, {
        signal: AbortSignal.timeout(config.oauth.statusTimeoutMs),
      });
      if (upstream.ok) ctx.oauthReadyState = "ready";
      res.status(upstream.status);
      copyProxyHeaders(upstream, res);
      if (upstream.body) Readable.fromWeb(upstream.body as any).pipe(res);
      else res.end();
    } catch (err: any) {
      res.status(502).json({
        error: "OAuth models request failed",
        code: "LLM_MODELS_FAILED",
        message: err?.message || String(err),
      });
    }
  });

  app.post("/v1/responses", (req, res) => proxyJsonEndpoint(req, res, ctx, "/v1/responses"));
  app.post("/v1/chat/completions", (req, res) => proxyJsonEndpoint(req, res, ctx, "/v1/chat/completions"));

  app.post("/api/text", async (req, res) => {
    try {
      const useResponses = req.body?.endpoint === "responses";
      const path = useResponses ? "/v1/responses" : "/v1/chat/completions";
      const body = useResponses ? buildTextResponseBody(req.body) : buildTextChatBody(req.body);
      const upstream = await fetchOAuthJson(ctx.oauthUrl, path, body);
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => "");
        return res.status(upstream.status).json({
          error: "LLM upstream failed",
          code: "LLM_UPSTREAM_FAILED",
          upstreamStatus: upstream.status,
          upstreamBody: text,
        });
      }
      ctx.oauthReadyState = "ready";
      if (body.stream) {
        res.status(upstream.status);
        copyProxyHeaders(upstream, res);
        if (upstream.body) Readable.fromWeb(upstream.body as any).pipe(res);
        else res.end();
        return;
      }
      const json: any = await upstream.json();
      const text = useResponses
        ? createTextFromResponse(json)
        : String(json?.choices?.[0]?.message?.content ?? "");
      res.json({
        text,
        model: json?.model || body.model,
        usage: json?.usage || null,
        endpoint: useResponses ? "responses" : "chat.completions",
        raw: req.body?.raw === true ? json : undefined,
      });
    } catch (err: any) {
      const aborted = err?.name === "AbortError";
      res.status(aborted ? 504 : 502).json({
        error: aborted ? "LLM OAuth request timed out" : "LLM OAuth request failed",
        code: aborted ? "LLM_OAUTH_TIMEOUT" : "LLM_OAUTH_FAILED",
        message: err?.message || String(err),
      });
    }
  });

  return app;
}

export async function startLlmServer(overrides: any = {}) {
  const oauthPort = config.oauth.proxyPort;
  const ctx: any = {
    oauthPort,
    oauthActualPort: oauthPort,
    oauthUrl: `http://127.0.0.1:${oauthPort}`,
    oauthReadyState: config.oauth.autoStart ? "starting" : "disabled",
    llmActualPort: null,
    llmUrl: `http://${runtimeHostUrl(config.llm.host)}:${config.llm.port}`,
  };

  let oauthChild = null;
  if (overrides.oauthChild !== undefined) {
    oauthChild = overrides.oauthChild;
    ctx.oauthReadyState = "ready";
  } else if (config.oauth.autoStart) {
    const existingReady = await isOAuthProxyReady(ctx.oauthUrl);
    if (existingReady) {
      console.log(`[oauth] reusing existing openai-oauth at ${ctx.oauthUrl}`);
      ctx.oauthReadyState = "ready";
    } else if (await isTcpPortListening(oauthPort)) {
      console.warn(`[oauth] port ${oauthPort} is already in use; reusing configured URL and checking per request`);
      ctx.oauthReadyState = "unknown";
    } else {
      oauthChild = startOAuthProxy({
        oauthPort,
        restartDelayMs: config.oauth.restartDelayMs,
        onReady: ({ url, port }) => {
          ctx.oauthUrl = url || ctx.oauthUrl;
          ctx.oauthActualPort = port || oauthPort;
          ctx.oauthReadyState = "ready";
        },
        onExit: () => {
          ctx.oauthReadyState = "failed";
        },
      });
    }
  } else {
    ctx.oauthReadyState = "ready";
  }

  onShutdown(() => {
    try { oauthChild?.stop?.(); } catch {}
    try { oauthChild?.kill?.(); } catch {}
  });

  const app = buildLlmApp(ctx);
  const server: any = await listenWithPortFallback(app, config.llm.port, {
    host: config.llm.host,
    label: "llm",
    onFallback: ({ requestedPort, actualPort }) => {
      console.log(`[llm.port] requested=${requestedPort} actual=${actualPort} reason=EADDRINUSE`);
    },
  });
  ctx.llmActualPort = getServerPort(server) || config.llm.port;
  ctx.llmUrl = `http://${runtimeHostUrl(config.llm.host)}:${ctx.llmActualPort}`;
  console.log(`LLM proxy running at ${ctx.llmUrl}`);
  console.log(`OAuth proxy: ${ctx.oauthUrl} (${ctx.oauthReadyState})`);
  return { app, server, oauthChild, ctx };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startLlmServer();
}
