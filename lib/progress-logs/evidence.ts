export type ProgressPhoto = { path: string; name: string; type: string; size: number };
export const MAX_LOG_PHOTOS = 6;
export const MAX_LOG_PHOTO_BYTES = 5 * 1024 * 1024;
export const LOG_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function validateLogEvidence(remarks: unknown, photos: unknown, projectId: number) {
  if (remarks != null && typeof remarks !== "string") return { error: "Enter valid remarks." };
  const text = (remarks as string | undefined)?.trim() ?? "";
  if (text.length > 2000) return { error: "Keep remarks within 2,000 characters." };
  if (photos != null && !Array.isArray(photos)) return { error: "Choose valid photos." };
  const rows = (photos ?? []) as ProgressPhoto[];
  if (rows.length > MAX_LOG_PHOTOS) return { error: "Attach up to 6 photos per log." };
  const seen = new Set<string>();
  for (const photo of rows) {
    if (!photo || typeof photo.path !== "string" || !photo.path.startsWith(`${projectId}/`) || photo.path.includes("..") ||
        typeof photo.name !== "string" || !photo.name.trim() || photo.name.length > 200 ||
        !LOG_PHOTO_TYPES.includes(photo.type) || !Number.isSafeInteger(photo.size) || photo.size <= 0 || photo.size > MAX_LOG_PHOTO_BYTES || seen.has(photo.path)) {
      return { error: "Choose JPG, PNG, or WebP photos up to 5 MB each from this project." };
    }
    seen.add(photo.path);
  }
  return { remarks: text, photos: rows.map(({path,name,type,size}) => ({path,name,type,size})) };
}

export function progressPhotoUrl(projectId: number, photo: ProgressPhoto) {
  return `/api/progress-photos?projectId=${projectId}&path=${encodeURIComponent(photo.path)}`;
}
