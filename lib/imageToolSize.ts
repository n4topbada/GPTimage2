const SUPPORTED_IMAGE_TOOL_SIZES = new Set([
  "auto",
  "1672x941",
  "2048x1152",
  "1872x1248",
  "1248x1872",
  "1152x2048",
  "1536x1536",
  "3840x2160",
  "3520x2352",
  "2352x3520",
  "2160x3840",
  "2880x2880",
]);

export function normalizeImageToolSize(size) {
  const requestedSize = typeof size === "string" && size.trim() ? size.trim() : "1024x1024";
  if (SUPPORTED_IMAGE_TOOL_SIZES.has(requestedSize)) {
    return { size: requestedSize, requestedSize, adjusted: false };
  }
  const match = /^(\d+)x(\d+)$/.exec(requestedSize);
  if (!match) return { size: "auto", requestedSize, adjusted: true };
  const w = Number.parseInt(match[1], 10);
  const h = Number.parseInt(match[2], 10);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { size: "auto", requestedSize, adjusted: true };
  }
  if (Math.abs(w - h) / Math.max(w, h) < 0.08) {
    return { size: "1024x1024", requestedSize, adjusted: true };
  }
  return {
    size: w > h ? "1536x1024" : "1024x1536",
    requestedSize,
    adjusted: true,
  };
}
