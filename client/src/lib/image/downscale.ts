/**
 * Turns a user-picked image file into a small square data URI.
 *
 * The whole point is that this happens in the browser. A profile picture arrives as whatever the
 * camera produced — frequently several megabytes — and it is stored inline in a Firestore document
 * that gets read on every page load. Downscaling before upload is what makes storing it inline
 * defensible at all: the result is a few kilobytes, so there is no bucket to provision and no
 * second set of storage rules to get wrong.
 *
 * Re-encoding through a canvas also strips everything that isn't pixels — EXIF, GPS coordinates,
 * embedded color profiles, and any script riding along in a format that allows it. What reaches
 * the server is a bitmap the browser drew, not the file the user chose.
 */

/** Rendered at 96px at the largest, on a 2x display. 256 leaves room without wasting bytes. */
const TARGET_SIZE = 256;

/** Kept comfortably under the server's cap so a rounding difference can't push a valid file over. */
const MAX_CHARS = 40_000;

/** Quality ladder, tried in order until the encoded result fits the budget. */
const QUALITY_STEPS = [0.85, 0.7, 0.55, 0.4];

export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageError';
  }
}

/** Rejecting early gives a better message than letting `createImageBitmap` fail on a PDF. */
const ACCEPTED_INPUT = /^image\/(png|jpeg|webp|gif|bmp)$/;

/** A generous ceiling on the *input* file — decoding a 100MP image is what actually hurts. */
const MAX_INPUT_BYTES = 20 * 1024 * 1024;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageError('That image could not be read.'));
    };

    image.src = url;
  });
}

/**
 * Center-crops to a square and scales to `TARGET_SIZE`.
 *
 * Cropping rather than letterboxing because the result is always displayed as a circle — padding a
 * wide photo to a square would just show two empty wedges.
 */
function drawSquare(image: HTMLImageElement): HTMLCanvasElement {
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const sx = (image.naturalWidth - side) / 2;
  const sy = (image.naturalHeight - side) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = TARGET_SIZE;
  canvas.height = TARGET_SIZE;

  const context = canvas.getContext('2d');
  if (!context) throw new ImageError('This browser could not process the image.');

  context.imageSmoothingQuality = 'high';
  context.drawImage(image, sx, sy, side, side, 0, 0, TARGET_SIZE, TARGET_SIZE);

  return canvas;
}

/**
 * Encodes to the smallest acceptable result, preferring WebP.
 *
 * `toDataURL` silently falls back to PNG when asked for a format the browser cannot encode, so the
 * returned string is checked rather than assumed — a PNG that fits the budget is a fine outcome,
 * one that doesn't needs to fail loudly rather than upload something the server will reject.
 */
function encode(canvas: HTMLCanvasElement): string {
  let smallest: string | null = null;

  for (const quality of QUALITY_STEPS) {
    const webp = canvas.toDataURL('image/webp', quality);
    if (webp.startsWith('data:image/webp')) {
      if (webp.length <= MAX_CHARS) return webp;
      smallest = webp;
      continue;
    }

    // No WebP encoder — JPEG is the next best thing that still honours a quality setting.
    const jpeg = canvas.toDataURL('image/jpeg', quality);
    if (jpeg.length <= MAX_CHARS) return jpeg;
    smallest = jpeg;
  }

  throw new ImageError(
    smallest === null
      ? 'That image could not be converted.'
      : 'That image is too detailed to store even after compressing. Try a simpler picture.',
  );
}

export async function fileToAvatarDataUri(file: File): Promise<string> {
  if (!ACCEPTED_INPUT.test(file.type)) {
    throw new ImageError('Pick a PNG, JPEG, WebP, GIF or BMP image.');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new ImageError('That file is over 20MB. Try a smaller image.');
  }

  const image = await loadImage(file);
  return encode(drawSquare(image));
}
