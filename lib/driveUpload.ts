import { access } from "node:fs/promises";
import { join, sep } from "node:path";
import { spawn } from "node:child_process";
import { logError, logEvent } from "./logger.js";

function normalizeRemotePrefix(remote) {
  const raw = String(remote || "").trim();
  if (!raw) return "";
  return raw.endsWith(":") ? raw : `${raw}:`;
}

function normalizeRemotePart(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function toRemotePath(config, relativePath) {
  const remote = normalizeRemotePrefix(config.remote);
  if (!remote) return "";
  const folder = normalizeRemotePart(config.folder);
  const rel = normalizeRemotePart(String(relativePath || "").split(sep).join("/"));
  return `${remote}${[folder, rel].filter(Boolean).join("/")}`;
}

function runRcloneCopyTo(command, source, destination) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["copyto", source, destination], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      const err: any = new Error(stderr.trim() || `rclone exited with code ${code}`);
      err.code = "RCLONE_UPLOAD_FAILED";
      reject(err);
    });
  });
}

async function uploadOne(ctx, relativePath) {
  const cfg = ctx.config.driveUpload;
  if (!cfg?.enabled) return;
  const destination = toRemotePath(cfg, relativePath);
  if (!destination) return;
  const source = join(ctx.config.storage.generatedDir, relativePath);
  await access(source);
  await runRcloneCopyTo(cfg.command || "rclone", source, destination);
  logEvent("drive-upload", "uploaded", {
    relativePath,
    destination,
  });
}

export function queueGeneratedDriveUpload(ctx, relativePath, options: any = {}) {
  const cfg = ctx.config.driveUpload;
  if (!cfg?.enabled) return;
  const rel = String(relativePath || "");
  if (!rel) return;
  void (async () => {
    await uploadOne(ctx, rel);
    if (options.includeSidecar !== false && cfg.includeSidecar) {
      await uploadOne(ctx, `${rel}.json`).catch((err) => {
        if (err?.code !== "ENOENT") throw err;
      });
    }
  })().catch((err) => {
    logError("drive-upload", "error", err, { relativePath: rel });
  });
}
