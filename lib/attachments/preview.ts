export type AttachmentKind = "image" | "pdf" | "unsupported";

/** MIME metadata takes precedence; extensions cover older URL-only attachments. */
export function attachmentKind(type = "", name = "", url = ""): AttachmentKind {
  const mime = type.split(";")[0].trim().toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (/^image\/(jpeg|png|webp|gif|bmp|avif|svg\+xml)$/.test(mime)) return "image";
  if (mime && mime !== "application/octet-stream") return "unsupported";
  const path = (name || url).split(/[?#]/)[0].toLowerCase();
  if (/\.pdf$/.test(path)) return "pdf";
  if (/\.(jpe?g|png|webp|gif|bmp|avif|svg)$/.test(path)) return "image";
  // Descriptive titles need not contain an extension; try the original URL too.
  if (name && url) return attachmentKind("", "", url);
  return "unsupported";
}

export function safeAttachmentUrl(url: string, origin: string) {
  try {
    const parsed = new URL(url, origin);
    return ["https:", "http:", "blob:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null;
  } catch { return null; }
}

export function attachmentDownloadName(name: string, url: string, type: string) {
  let value = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").trim() || "Attachment";
  if (!/\.[a-z0-9]{1,8}$/i.test(value)) {
    const extension = url.split(/[?#]/)[0].match(/\.([a-z0-9]{1,8})$/i)?.[1];
    const mimeExtension: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
    const suffix = extension || mimeExtension[type.split(";")[0].toLowerCase()];
    if (suffix) value += `.${suffix}`;
  }
  return value;
}

/** Download is always an explicit action; previews never navigate to a file URL. */
export async function downloadAttachment(url: string, name: string) {
  const safe = safeAttachmentUrl(url, window.location.href);
  if (!safe) throw new Error("Invalid attachment URL.");
  const response = await fetch(safe, { credentials: "same-origin" });
  if (!response.ok) throw new Error("Could not download the attachment. Please try again.");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = attachmentDownloadName(name, url, blob.type);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}
