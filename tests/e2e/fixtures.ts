import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Fixture files (see fixtures/ATTRIBUTION.md), as paths for uploads and as API parts. */
const dir = path.join(__dirname, "fixtures");

export const FILES = {
  motherboard: path.join(dir, "motherboard.jpg"),
  banana: path.join(dir, "banana.jpg"),
  hindiNote: path.join(dir, "hindi-note.wav"),
};

export function mediaPart(file: string, mimeType: string) {
  return { mimeType, dataBase64: readFileSync(file).toString("base64") };
}

/**
 * A JPEG with random bytes after its end-of-image marker. Decoders ignore trailing data,
 * so the picture is identical, but the content hash is new. The archive and the records
 * deduplicate by that hash (resending the same photo resolves to the item it already
 * priced), so every test that expects a fresh item needs its own copy.
 */
export function uniqueJpeg(file: string): Buffer {
  return Buffer.concat([readFileSync(file), randomBytes(32)]);
}

const jpegPart = (buffer: Buffer) => ({ mimeType: "image/jpeg", dataBase64: buffer.toString("base64") });

/** A fresh-hash motherboard photo, as an API part. */
export const MOTHERBOARD = () => jpegPart(uniqueJpeg(FILES.motherboard));
export const BANANA = () => jpegPart(uniqueJpeg(FILES.banana));

/** A fresh-hash photo, in the shape `setInputFiles` takes. */
export const uploadable = (file: string, name: string) => ({ name, mimeType: "image/jpeg", buffer: uniqueJpeg(file) });
export const HINDI_NOTE = () => mediaPart(FILES.hindiNote, "audio/wav");

/** Same-origin headers the app's guards expect from a browser. */
export const sameOrigin = (baseURL: string | undefined) => ({ origin: baseURL ?? "", "sec-fetch-site": "same-origin" });

/** Devanagari — the Hindi transcript must actually be Hindi. */
export const DEVANAGARI = /[ऀ-ॿ]/;
