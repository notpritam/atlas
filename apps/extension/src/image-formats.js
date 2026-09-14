export const CLOUD_IMAGE_MIME_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export function cloudImageMime(blob) {
  const mime = blob?.type?.toLowerCase();
  if (!CLOUD_IMAGE_MIME_TYPES.includes(mime)) {
    throw new Error(
      "FoundKeep can save PNG, JPEG, and WebP images. This image uses an unsupported format.",
    );
  }
  return mime;
}
