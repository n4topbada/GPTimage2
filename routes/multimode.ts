import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";
import { summarizeReferencePayload, validateAndNormalizeRefs } from "../lib/refs.js";
import { classifyUpstreamError } from "../lib/errorClassify.js";
import { normalizeOAuthParams } from "../lib/oauthNormalize.js";
import { normalizeImageModel, normalizeReasoningEffort } from "../lib/imageModels.js";
import { normalizeImageToolSize } from "../lib/imageToolSize.js";
import { generateMultimodeViaOAuth } from "../lib/oauthProxy.js";
import { startJob, finishJob } from "../lib/inflight.js";
import { logEvent, logError } from "../lib/logger.js";
import { embedImageMetadataBestEffort } from "../lib/imageMetadataStore.js";
import { isRequestQueuedBeforeServerBoot, staleClientQueuePayload } from "../lib/requestFreshness.js";
import { queueGeneratedDriveUpload } from "../lib/driveUpload.js";

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function validateModeration(ctx, moderation) {
  if (typeof moderation !== "string" || !ctx.config.oauth.validModeration.has(moderation)) {
    return { error: "moderation must be one of: auto, low" };
  }
  return { moderation };
}

function normalizeMaxImages(value) {
  return Math.min(10, Math.max(1, Math.trunc(Number(value) || 1)));
}

function sequenceStatus(returned, requested) {
  if (returned <= 0) return "empty";
  if (returned < requested) return "partial";
  return "complete";
}

export function registerMultimodeRoutes(app, ctx) {
  app.post("/api/generate/multimode", async (req, res) => {
    const requestId = typeof req.body?.requestId === "string" ? req.body.requestId : req.id;
    let finishStatus = "completed";
    let finishHttpStatus = 200;
    let finishErrorCode;
    let finishErrorMessage;
    let finishMeta = {};

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    if (isRequestQueuedBeforeServerBoot(requestId, ctx.startedAt)) {
      finishStatus = "error";
      finishHttpStatus = 409;
      finishErrorCode = "STALE_CLIENT_QUEUE";
      sendSse(res, "error", { ...staleClientQueuePayload(requestId), status: 409 });
      res.end();
      return;
    }

    try {
      const {
        prompt,
        quality: rawQuality = "medium",
        size = "1024x1024",
        format = "png",
        moderation = "low",
        provider = "auto",
        references = [],
        mode: promptMode = "auto",
        model: rawModel,
        reasoningEffort: rawReasoningEffort,
        webSearchEnabled: rawWebSearchEnabled = false,
      } = req.body;
      const maxImages = normalizeMaxImages(req.body?.maxImages);
      const normalizedPromptMode = promptMode === "direct" ? "direct" : "auto";
      const { quality, warnings: qualityWarnings } = normalizeOAuthParams({ provider, quality: rawQuality });
      const modelCheck = normalizeImageModel(ctx, rawModel);
      if (modelCheck.error) {
        finishStatus = "error";
        finishHttpStatus = modelCheck.status;
        finishErrorCode = modelCheck.code;
        sendSse(res, "error", { error: modelCheck.error, code: modelCheck.code, status: modelCheck.status, requestId });
        return;
      }
      const imageModel = modelCheck.model;
      const reasoningCheck = normalizeReasoningEffort(ctx, rawReasoningEffort);
      if (reasoningCheck.error) {
        finishStatus = "error";
        finishHttpStatus = reasoningCheck.status;
        finishErrorCode = reasoningCheck.code;
        sendSse(res, "error", { error: reasoningCheck.error, code: reasoningCheck.code, status: reasoningCheck.status, requestId });
        return;
      }
      const reasoningEffort = reasoningCheck.effort;
      const webSearchEnabled = rawWebSearchEnabled !== false;
      const sizeCheck = normalizeImageToolSize(size);
      const outputSize = sizeCheck.size;
      const cacheBust = ctx.config?.oauth?.cacheBust === true;
      if (!prompt) {
        finishStatus = "error";
        finishHttpStatus = 400;
        finishErrorCode = "PROMPT_REQUIRED";
        sendSse(res, "error", { error: "Prompt is required", code: finishErrorCode, status: 400, requestId });
        return;
      }
      const moderationCheck = validateModeration(ctx, moderation);
      if (moderationCheck.error) {
        finishStatus = "error";
        finishHttpStatus = 400;
        finishErrorCode = "INVALID_MODERATION";
        sendSse(res, "error", { error: moderationCheck.error, code: finishErrorCode, status: 400, requestId });
        return;
      }
      if (provider === "api") {
        finishStatus = "error";
        finishHttpStatus = 403;
        finishErrorCode = "APIKEY_DISABLED";
        sendSse(res, "error", {
          error: "API key provider is disabled. Use OAuth (Codex login).",
          code: finishErrorCode,
          status: 403,
          requestId,
        });
        return;
      }

      const refCheck = validateAndNormalizeRefs(references);
      if (refCheck.error) {
        finishStatus = "error";
        finishHttpStatus = 400;
        finishErrorCode = refCheck.code;
        sendSse(res, "error", { error: refCheck.error, code: refCheck.code, status: 400, requestId });
        return;
      }
      const referencePayload = summarizeReferencePayload(references);

      startJob({
        requestId,
        kind: "multimode",
        prompt,
        meta: {
          kind: "multimode",
          quality,
          model: imageModel,
          promptMode: normalizedPromptMode,
          webSearchEnabled,
          cacheBust,
          size: outputSize,
          requestedSize: sizeCheck.requestedSize,
          sizeAdjusted: sizeCheck.adjusted,
          maxImages,
          refsCount: referencePayload.refsCount,
          referenceBytes: referencePayload.referenceBytes,
          referenceB64Chars: referencePayload.referenceB64Chars,
        },
      });

      logEvent("multimode", "request", {
        requestId,
        quality,
        model: imageModel,
        size: outputSize,
        requestedSize: sizeCheck.requestedSize,
        sizeAdjusted: sizeCheck.adjusted,
        moderation,
        maxImages,
        refs: refCheck.refs.length,
        referenceBytes: referencePayload.referenceBytes,
        promptChars: typeof prompt === "string" ? prompt.length : 0,
        webSearchEnabled,
        cacheBust,
      });

      const startTime = Date.now();
      const mimeMap = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
      const mime = mimeMap[format] || "image/png";
      const sequenceId = `seq_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
      await mkdir(ctx.config.storage.generatedDir, { recursive: true });

      sendSse(res, "phase", { phase: "streaming", requestId, sequenceId, maxImages });
      const generated = await generateMultimodeViaOAuth(
        prompt,
        quality,
        outputSize,
        moderation,
        refCheck.refDetails || refCheck.refs,
        requestId,
        normalizedPromptMode,
        ctx,
        {
          model: imageModel,
          maxImages,
          reasoningEffort,
          webSearchEnabled,
          inputFidelity: refCheck.refs.length > 0 ? "high" : undefined,
          onPartialImage: (partial) =>
            sendSse(res, "partial", {
              image: `data:${mime};base64,${partial.b64}`,
              requestId,
              sequenceId,
              index: partial.index,
            }),
        },
      );

      const returned = generated.images.length;
      const status = sequenceStatus(returned, maxImages);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const images = [];

      for (const [index, image] of generated.images.entries()) {
        const rand = randomBytes(ctx.config.ids.generatedHexBytes).toString("hex");
        const filename = `${Date.now()}_${rand}_multimode_${index}.${format}`;
        const meta = {
          kind: "multimode-image",
          generationStrategy: "one-call-text-sequence",
          sequenceId,
          sequenceIndex: index + 1,
          sequenceTotalRequested: maxImages,
          sequenceTotalReturned: returned,
          sequenceStatus: status,
          stageLabel: String.fromCharCode(65 + index),
          requestId,
          prompt,
          userPrompt: prompt,
          revisedPrompt: image.revisedPrompt || null,
          promptMode: normalizedPromptMode,
          quality,
          size: outputSize,
          requestedSize: sizeCheck.requestedSize,
          sizeAdjusted: sizeCheck.adjusted,
          format,
          moderation,
          model: imageModel,
          provider: "oauth",
          createdAt: Date.now(),
          usage: generated.usage || null,
          webSearchCalls: generated.webSearchCalls || 0,
          webSearchEnabled,
          refsCount: refCheck.refs.length,
        };
        const rawBuffer = Buffer.from(image.b64, "base64");
        const embedded = await embedImageMetadataBestEffort(rawBuffer, format, meta, {
          version: ctx.packageVersion,
        });
        await writeFile(join(ctx.config.storage.generatedDir, filename), embedded.buffer);
        await writeFile(join(ctx.config.storage.generatedDir, filename + ".json"), JSON.stringify(meta)).catch(() => {});
        queueGeneratedDriveUpload(ctx, filename);
        const item = {
          image: `data:${mime};base64,${image.b64}`,
          filename,
          revisedPrompt: image.revisedPrompt || null,
          sequenceId,
          sequenceIndex: index + 1,
          sequenceTotalRequested: maxImages,
          sequenceTotalReturned: returned,
          sequenceStatus: status,
        };
        images.push(item);
        sendSse(res, "image", item);
      }

      finishMeta = { sequenceId, imageCount: returned, maxImages, status };
      finishHttpStatus = 200;
      sendSse(res, "done", {
        ok: true,
        requestId,
        sequenceId,
        requested: maxImages,
        returned,
        status,
        elapsed,
        images,
        provider: "oauth",
        quality,
        size: outputSize,
        requestedSize: sizeCheck.requestedSize,
        sizeAdjusted: sizeCheck.adjusted,
        moderation,
        model: imageModel,
        usage: generated.usage || null,
        webSearchCalls: generated.webSearchCalls || 0,
        webSearchEnabled,
        warnings: qualityWarnings,
        extraIgnored: generated.extraIgnored || 0,
        promptMode: normalizedPromptMode,
      });
      logEvent("multimode", "saved", {
        requestId,
        sequenceId,
        imageCount: returned,
        maxImages,
        status,
        elapsedMs: Date.now() - startTime,
      });
    } catch (err) {
      const fallbackCode = err.code || classifyUpstreamError(err.message);
      finishStatus = "error";
      finishHttpStatus = err.status || 500;
      finishErrorCode = fallbackCode || "MULTIMODE_GENERATE_FAILED";
      finishErrorMessage = err.message;
      finishMeta = {
        ...finishMeta,
        errorDetails: {
          error: err.message,
          code: finishErrorCode,
          status: finishHttpStatus,
          requestId,
          upstreamCode: err.upstreamCode || null,
          upstreamType: err.upstreamType || null,
          upstreamParam: err.upstreamParam || null,
          upstreamDebug: err.upstreamDebug || null,
        },
      };
      logError("multimode", "error", err, { requestId, code: finishErrorCode });
      sendSse(res, "error", {
        error: err.message,
        code: finishErrorCode,
        status: finishHttpStatus,
        requestId,
        upstreamCode: err.upstreamCode || null,
        upstreamType: err.upstreamType || null,
        upstreamParam: err.upstreamParam || null,
        upstreamDebug: err.upstreamDebug || null,
      });
    } finally {
      finishJob(requestId, {
        status: finishStatus,
        httpStatus: finishHttpStatus,
        errorCode: finishErrorCode,
        errorMessage: finishErrorMessage,
        meta: finishMeta,
      });
      res.end();
    }
  });
}
