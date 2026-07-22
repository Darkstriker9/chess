// Resizes and re-encodes an image file entirely client-side before upload.
// A phone photo picked as an avatar can easily be 5-10MB at 4000px wide —
// nobody needs that for a 72px profile circle, and it matters concretely
// here because Firebase Storage bills by bytes stored and transferred.
// Downscaling before upload keeps every avatar small regardless of what
// the user actually picked.
export function resizeImageFile(file, { maxDim = 512, quality = 0.85 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not process that image."))),
        "image/jpeg",
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("That file doesn't look like a valid image."));
    };

    img.src = objectUrl;
  });
}
