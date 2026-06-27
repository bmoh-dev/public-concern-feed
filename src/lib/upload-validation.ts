// Shared (client + server) upload validation rules for complaint attachments.
// Server code MUST also enforce these — never trust the client.

export const ALLOWED_IMAGE_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

export const ALLOWED_PDF_MIME = ["application/pdf"] as const;

export const ALLOWED_MIME = [...ALLOWED_IMAGE_MIME, ...ALLOWED_PDF_MIME] as const;

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_PDF_BYTES = 10 * 1024 * 1024;  // 10 MB

export const MAX_IMAGES_PER_COMPLAINT = 5;
export const MAX_PDFS_PER_COMPLAINT = 1;
export const MAX_ATTACHMENTS_TOTAL = 6;

export type AttachmentMeta = {
  storage_path?: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
};

export function isImageMime(m: string): boolean {
  return (ALLOWED_IMAGE_MIME as readonly string[]).includes(m);
}
export function isPdfMime(m: string): boolean {
  return (ALLOWED_PDF_MIME as readonly string[]).includes(m);
}
export function isAllowedMime(m: string): boolean {
  return (ALLOWED_MIME as readonly string[]).includes(m);
}

/** Returns an Arabic error string if the single file is invalid, else null. */
export function validateSingleFile(meta: { mime_type: string; size_bytes: number; file_name: string }):
  | string
  | null {
  if (!isAllowedMime(meta.mime_type)) {
    return `نوع الملف غير مسموح به: ${meta.file_name}`;
  }
  if (isImageMime(meta.mime_type) && meta.size_bytes > MAX_IMAGE_BYTES) {
    return `الصورة ${meta.file_name} تتجاوز 5MB`;
  }
  if (isPdfMime(meta.mime_type) && meta.size_bytes > MAX_PDF_BYTES) {
    return `ملف PDF ${meta.file_name} يتجاوز 10MB`;
  }
  return null;
}

/** Validates the full set as a whole. Returns Arabic error or null. */
export function validateAttachmentSet(items: AttachmentMeta[]): string | null {
  if (items.length > MAX_ATTACHMENTS_TOTAL) {
    return `الحد الأقصى للمرفقات ${MAX_ATTACHMENTS_TOTAL} ملفات`;
  }
  let images = 0;
  let pdfs = 0;
  for (const it of items) {
    const err = validateSingleFile(it);
    if (err) return err;
    if (isImageMime(it.mime_type)) images++;
    if (isPdfMime(it.mime_type)) pdfs++;
  }
  if (images > MAX_IMAGES_PER_COMPLAINT) {
    return `الحد الأقصى ${MAX_IMAGES_PER_COMPLAINT} صور لكل شكوى`;
  }
  if (pdfs > MAX_PDFS_PER_COMPLAINT) {
    return `الحد الأقصى ${MAX_PDFS_PER_COMPLAINT} ملف PDF لكل شكوى`;
  }
  return null;
}

/** Stable dedup key for selected files (name + size + lastModified). */
export function fileDedupKey(f: { name: string; size: number; lastModified?: number }): string {
  return `${f.name}::${f.size}::${f.lastModified ?? 0}`;
}
