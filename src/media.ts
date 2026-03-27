/**
 * Media utilities — file type detection for attachment delivery.
 */

import { extname } from "path";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const VOICE_EXTENSIONS = new Set([".ogg"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".wav", ".aac"]);

export function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(filename).toLowerCase());
}

export function isVoiceFile(filename: string): boolean {
  return VOICE_EXTENSIONS.has(extname(filename).toLowerCase());
}

export function isAudioFile(filename: string): boolean {
  return AUDIO_EXTENSIONS.has(extname(filename).toLowerCase());
}
