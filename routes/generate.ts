import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";
import sharp from "sharp";
import { summarizeReferencePayload, validateAndNormalizeRefs } from "../lib/refs.js";
import { classifyUpstreamError } from "../lib/errorClassify.js";
import { normalizeOAuthParams } from "../lib/oauthNormalize.js";
import { normalizeImageModel, normalizeReasoningEffort } from "../lib/imageModels.js";
import { normalizeImageToolSize } from "../lib/imageToolSize.js";
import { generateViaOAuth } from "../lib/oauthProxy.js";
import { isNonRetryableGenerationError, normalizeGenerationFailure } from "../lib/generationErrors.js";
import { startJob, finishJob } from "../lib/inflight.js";
import { logEvent, logError } from "../lib/logger.js";
import { embedImageMetadataBestEffort } from "../lib/imageMetadataStore.js";
import { queueGeneratedDriveUpload } from "../lib/driveUpload.js";
import { isRequestQueuedBeforeServerBoot, staleClientQueuePayload } from "../lib/requestFreshness.js";

function validateModeration(ctx, moderation) {
  if (typeof moderation !== "string" || !ctx.config.oauth.validModeration.has(moderation)) {
    return { error: "moderation must be one of: auto, low" };
  }
  return { moderation };
}

function dimensionsForSize(size) {
  const match = /^(\d+)x(\d+)$/.exec(String(size || ""));
  if (!match) return null;
  const width = Number.parseInt(match[1], 10);
  const height = Number.parseInt(match[2], 10);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

async function normalizeOutputImageBuffer(buffer, format, outputSize) {
  const dimensions = dimensionsForSize(outputSize);
  if (!dimensions) return buffer;
  let pipeline = sharp(buffer).resize(dimensions.width, dimensions.height, { fit: "cover", position: "centre" });
  if (format === "jpeg" || format === "jpg") pipeline = pipeline.jpeg();
  else if (format === "webp") pipeline = pipeline.webp();
  else pipeline = pipeline.png();
  return pipeline.toBuffer();
}

function normalizeClientMeta(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const source = input;
  const out = {};
  const stringKeys = [
    "variant",
    "posePresetId",
    "posePresetTitle",
    "parentRequestId",
    "upstreamRequestId",
    "retryJitter",
  ];
  for (const key of stringKeys) {
    if (typeof source[key] === "string" && source[key].length <= 240) {
      out[key] = source[key];
    }
  }
  const numericKeys = ["posePresetIndex", "retryAttempt", "maxRetryAttempts"];
  for (const key of numericKeys) {
    if (Number.isFinite(source[key])) out[key] = source[key];
  }
  return out;
}

export function registerGenerateRoutes(app, ctx) {
  app.post("/api/generate", async (req, res) => {
    const requestId = typeof req.body?.requestId === "string" ? req.body.requestId : req.id;
    if (isRequestQueuedBeforeServerBoot(requestId, ctx.startedAt)) {
      return res.status(409).json(staleClientQueuePayload(requestId));
    }
    let finishStatus = "completed";
    let finishHttpStatus;
    let finishErrorCode;
    let finishErrorMessage;
    let finishMeta = {};
    try {
      const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : null;
      const clientNodeId = typeof req.body?.clientNodeId === "string" ? req.body.clientNodeId : null;
      const {
        prompt,
        quality: rawQuality = "medium",
        size = "1024x1024",
        format = "png",
        moderation = "low",
        provider = "auto",
        n = 1,
        references = [],
        mode: promptMode = "auto",
        model: rawModel,
        reasoningEffort: rawReasoningEffort,
        webSearchEnabled: rawWebSearchEnabled = false,
        clientMeta: rawClientMeta,
        displayPrompt: rawDisplayPrompt,
      } = req.body;
      const clientMeta = normalizeClientMeta(rawClientMeta);
      const displayPrompt =
        typeof rawDisplayPrompt === "string" && rawDisplayPrompt.trim()
          ? rawDisplayPrompt
          : prompt;
      const { quality, warnings: qualityWarnings } = normalizeOAuthParams({ provider, quality: rawQuality });
      const modelCheck = normalizeImageModel(ctx, rawModel);
      if (modelCheck.error) {
        finishStatus = "error";
        finishHttpStatus = modelCheck.status;
        finishErrorCode = modelCheck.code;
        return res.status(modelCheck.status).json({ error: modelCheck.error, code: modelCheck.code });
      }
      const imageModel = modelCheck.model;
      const modelSource = typeof rawModel === "string" && rawModel.length > 0 ? "request" : "config";
      const reasoningCheck = normalizeReasoningEffort(ctx, rawReasoningEffort);
      if (reasoningCheck.error) {
        finishStatus = "error";
        finishHttpStatus = reasoningCheck.status;
        finishErrorCode = reasoningCheck.code;
        return res.status(reasoningCheck.status).json({ error: reasoningCheck.error, code: reasoningCheck.code });
      }
      const reasoningEffort = reasoningCheck.effort;
      const reasoningEffortSource = typeof rawReasoningEffort === "string" && rawReasoningEffort.length > 0 ? "request" : "config";
      const webSearchEnabled = rawWebSearchEnabled !== false;
      const normalizedPromptMode = promptMode === "direct" ? "direct" : "auto";
      const sizeCheck = normalizeImageToolSize(size);
      const outputSize = sizeCheck.size;

      if (!prompt) return res.status(400).json({ error: "Prompt is required" });
      const moderationCheck = validateModeration(ctx, moderation);
      if (moderationCheck.error) return res.status(400).json({ error: moderationCheck.error });
      const count = Math.min(Math.max(parseInt(n) || 1, 1), ctx.config.limits.maxParallel);
      const referencePayload = summarizeReferencePayload(references);
      const cacheBust = ctx.config?.oauth?.cacheBust === true;

      startJob({
        requestId,
        kind: "classic",
        prompt,
        meta: {
          kind: "classic",
          sessionId,
          parentNodeId: null,
          clientNodeId,
          quality,
          model: imageModel,
          modelSource,
          reasoningEffort,
          reasoningEffortSource,
          promptMode: normalizedPromptMode,
          webSearchEnabled,
          cacheBust,
          size: outputSize,
          requestedSize: sizeCheck.requestedSize,
          sizeAdjusted: sizeCheck.adjusted,
          n: count,
          refsCount: referencePayload.refsCount,
          referenceBytes: referencePayload.referenceBytes,
          referenceB64Chars: referencePayload.referenceB64Chars,
          ...clientMeta,
        },
      });

      const refCheck = validateAndNormalizeRefs(references);
      if (refCheck.error) {
        finishStatus = "error";
        finishHttpStatus = 400;
        finishErrorCode = refCheck.code;
        return res.status(400).json({ error: refCheck.error, code: refCheck.code });
      }

      if (provider === "api") {
        finishStatus = "error";
        finishHttpStatus = 403;
        finishErrorCode = "APIKEY_DISABLED";
        return res.status(403).json({ error: "API key provider is disabled. Use OAuth (Codex login).", code: "APIKEY_DISABLED" });
      }
      const client = req.get("x-ima2-client") || "ui";
      const referenceDiagnostics = refCheck.referenceDiagnostics || [];
      const referenceMismatchCount = referenceDiagnostics.filter((ref) => ref.warnings?.includes("mime_mismatch")).length;
      logEvent("generate", "request", {
        requestId,
        client,
        provider: "oauth",
        quality,
        model: imageModel,
        modelSource,
        reasoningEffort,
        reasoningEffortSource,
        size: outputSize,
        requestedSize: sizeCheck.requestedSize,
        sizeAdjusted: sizeCheck.adjusted,
        moderation,
        n: count,
        refs: refCheck.refs.length,
        referenceBytes: referencePayload.referenceBytes,
        referenceMismatchCount,
        refDetectedMimes: [...new Set(referenceDiagnostics.map((ref) => ref.detectedMime).filter(Boolean))].join(","),
        refDeclaredMimes: [...new Set(referenceDiagnostics.map((ref) => ref.declaredMime).filter(Boolean))].join(","),
        sessionId,
        clientNodeId,
        promptChars: typeof prompt === "string" ? prompt.length : 0,
        promptMode: normalizedPromptMode,
        webSearchEnabled,
        cacheBust,
        ...clientMeta,
      });
      const startTime = Date.now();

      const mimeMap = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
      const mime = mimeMap[format] || "image/png";
      await mkdir(ctx.config.storage.generatedDir, { recursive: true });

      const generateOne = async () => {
        // Retry chain: keep the developer prompt on every attempt so the
        // creative-tool framing and Direct-mode fidelity rules are always sent.
        // The final attempt only drops optional refs/search, not the framing.
        const MAX_RETRIES = 2;
        let lastErr;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          const isFinalAttempt = attempt === MAX_RETRIES;
          try {
            const r = await generateViaOAuth(
              prompt,
              quality,
              outputSize,
              moderation,
              isFinalAttempt ? [] : (refCheck.refDetails || refCheck.refs),
              requestId,
              normalizedPromptMode,
              ctx,
              {
                model: imageModel,
                reasoningEffort,
                webSearchEnabled: isFinalAttempt ? false : webSearchEnabled,
                imageAction: "generate",
                inputFidelity: !isFinalAttempt && refCheck.refs.length > 0 ? "high" : undefined,
              },
            );
            if (r.b64) return r;
            lastErr = new Error("Empty response (safety refusal)");
          } catch (e) {
            lastErr = e;
            if (isNonRetryableGenerationError(e)) break;
          }
          if (attempt < MAX_RETRIES) {
            logEvent("generate", "retry", {
              requestId,
              attempt: attempt + 1,
              errorCode: lastErr?.code,
              retryKind: attempt + 1 === MAX_RETRIES ? "prompt_only_framing_kept" : "prompt_only_with_developer",
            });
          }
        }
        throw normalizeGenerationFailure(lastErr, {
          safetyMessage: "Content generation refused by moderation",
        });
      };

      const results = await Promise.allSettled(Array.from({ length: count }, generateOne));
      const images = [];
      let totalUsage = null;
      let totalWebSearchCalls = 0;
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.b64) {
          const rand = randomBytes(ctx.config.ids.generatedHexBytes).toString("hex");
          const filename = `${Date.now()}_${rand}_${images.length}.${format}`;
          const meta = {
            kind: "classic",
            requestId,
            sessionId,
            clientNodeId,
            prompt,
            userPrompt: displayPrompt,
            revisedPrompt: r.value.revisedPrompt || null,
            promptMode: normalizedPromptMode,
            quality,
            size: outputSize,
            requestedSize: sizeCheck.requestedSize,
            sizeAdjusted: sizeCheck.adjusted,
            format,
            moderation,
            model: imageModel,
            modelSource,
            reasoningEffort,
            reasoningEffortSource,
            provider: "oauth",
            createdAt: Date.now(),
            usage: r.value.usage || null,
            webSearchCalls: r.value.webSearchCalls || 0,
            webSearchEnabled,
            refsCount: refCheck.refs.length,
            ...clientMeta,
          };
          const rawBuffer = await normalizeOutputImageBuffer(Buffer.from(r.value.b64, "base64"), format, outputSize);
          const finalB64 = rawBuffer.toString("base64");
          const embedded: any = await embedImageMetadataBestEffort(rawBuffer, format, meta, {
            version: ctx.packageVersion,
          });
          if (!embedded.embedded) {
            logEvent("generate", "metadata_embed_skipped", {
              requestId,
              filename,
              code: embedded.code,
              warning: embedded.warning,
            });
          }
          await writeFile(join(ctx.config.storage.generatedDir, filename), embedded.buffer);
          await writeFile(join(ctx.config.storage.generatedDir, filename + ".json"), JSON.stringify(meta)).catch(() => {});
          queueGeneratedDriveUpload(ctx, filename);
          images.push({
            image: `data:${mime};base64,${finalB64}`,
            filename,
            revisedPrompt: r.value.revisedPrompt || null,
          });
          if (r.value.usage) {
            if (!totalUsage) totalUsage = { ...r.value.usage };
            else Object.keys(r.value.usage).forEach((k) => {
              if (typeof r.value.usage[k] === "number") totalUsage[k] = (totalUsage[k] || 0) + r.value.usage[k];
            });
          }
          if (typeof r.value.webSearchCalls === "number") totalWebSearchCalls += r.value.webSearchCalls;
        } else if (r.status === "rejected") {
          logError("generate", "parallel_failed", r.reason, { requestId });
        }
      }

      if (images.length === 0) {
        const firstErr = results.find((r) => r.status === "rejected")?.reason;
        if (firstErr?.code) {
          const status = firstErr.status || 500;
          const errorDetails = {
            error: firstErr.message,
            code: firstErr.code,
            upstreamCode: firstErr.upstreamCode || null,
            upstreamType: firstErr.upstreamType || null,
            upstreamParam: firstErr.upstreamParam || null,
            diagnosticReason: firstErr.diagnosticReason || null,
            retryKind: firstErr.retryKind || null,
            referencesDroppedOnRetry: firstErr.referencesDroppedOnRetry ?? null,
            errorEventCount: firstErr.eventCount ?? null,
            upstreamDebug: firstErr.upstreamDebug || null,
            requestId,
          };
          finishStatus = "error";
          finishHttpStatus = status;
          finishErrorCode = firstErr.code;
          finishErrorMessage = firstErr.message;
          finishMeta = {
            ...finishMeta,
            ...clientMeta,
            errorDetails,
          };
          return res.status(status).json({
            ...errorDetails,
          });
        }
        finishStatus = "error";
        finishHttpStatus = 500;
        finishErrorCode = "GENERATE_ALL_FAILED";
        return res.status(500).json({ error: "All generation attempts failed" });
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const firstRevised = images[0]?.revisedPrompt || null;
      const extra = {
        usage: totalUsage,
        provider: "oauth",
        webSearchCalls: totalWebSearchCalls,
        quality,
        size: outputSize,
        requestedSize: sizeCheck.requestedSize,
        sizeAdjusted: sizeCheck.adjusted,
        moderation,
        model: imageModel,
        modelSource,
        reasoningEffort,
        reasoningEffortSource,
        warnings: qualityWarnings,
        revisedPrompt: firstRevised,
        promptMode: normalizedPromptMode,
        webSearchEnabled,
      };

      if (count === 1) {
        finishHttpStatus = 200;
        finishMeta = { ...clientMeta, filenames: [images[0].filename], imageCount: 1 };
        logEvent("generate", "saved", {
          requestId,
          imageCount: 1,
          elapsedMs: Date.now() - startTime,
          filename: images[0].filename,
        });
        res.json({ image: images[0].image, elapsed, filename: images[0].filename, requestId, ...extra });
      } else {
        finishHttpStatus = 200;
        finishMeta = { ...clientMeta, filenames: images.map((image) => image.filename), imageCount: images.length };
        logEvent("generate", "saved", {
          requestId,
          imageCount: images.length,
          elapsedMs: Date.now() - startTime,
        });
        res.json({ images, elapsed, count: images.length, requestId, ...extra });
      }
    } catch (err) {
      const fallbackCode = err.code || classifyUpstreamError(err.message);
      finishStatus = "error";
      finishHttpStatus = err.status || 500;
      finishErrorCode = fallbackCode || "GENERATE_FAILED";
      finishErrorMessage = err.message;
      finishMeta = {
        ...finishMeta,
        errorDetails: {
          error: err.message,
          code: fallbackCode,
          upstreamCode: err.upstreamCode || null,
          upstreamType: err.upstreamType || null,
          upstreamParam: err.upstreamParam || null,
          diagnosticReason: err.diagnosticReason || null,
          retryKind: err.retryKind || null,
          referencesDroppedOnRetry: err.referencesDroppedOnRetry ?? null,
          errorEventCount: err.eventCount ?? null,
          upstreamDebug: err.upstreamDebug || null,
          requestId,
        },
      };
      logError("generate", "error", err, { requestId, code: finishErrorCode });
      res.status(err.status || 500).json({
        error: err.message,
        code: fallbackCode,
        upstreamCode: err.upstreamCode || null,
        upstreamType: err.upstreamType || null,
        upstreamParam: err.upstreamParam || null,
        diagnosticReason: err.diagnosticReason || null,
        retryKind: err.retryKind || null,
        referencesDroppedOnRetry: err.referencesDroppedOnRetry ?? null,
        errorEventCount: err.eventCount ?? null,
        upstreamDebug: err.upstreamDebug || null,
        requestId,
      });
    } finally {
      finishJob(requestId, {
        status: finishStatus,
        httpStatus: finishHttpStatus,
        errorCode: finishErrorCode,
        errorMessage: finishErrorMessage,
        meta: finishMeta,
      });
    }
  });
}
