import { describe, expect, test } from "bun:test";
import { isImageFile, isVoiceFile, isAudioFile } from "../src/media";

describe("file type detection", () => {
  test("isImageFile detects images", () => {
    expect(isImageFile("photo.jpg")).toBe(true);
    expect(isImageFile("photo.jpeg")).toBe(true);
    expect(isImageFile("photo.png")).toBe(true);
    expect(isImageFile("photo.gif")).toBe(true);
    expect(isImageFile("photo.webp")).toBe(true);
    expect(isImageFile("photo.pdf")).toBe(false);
    expect(isImageFile("photo.txt")).toBe(false);
    expect(isImageFile("photo.ogg")).toBe(false);
  });

  test("isVoiceFile detects ogg", () => {
    expect(isVoiceFile("voice.ogg")).toBe(true);
    expect(isVoiceFile("voice.OGG")).toBe(true);
    expect(isVoiceFile("voice.mp3")).toBe(false);
  });

  test("isAudioFile detects audio formats", () => {
    expect(isAudioFile("song.mp3")).toBe(true);
    expect(isAudioFile("song.m4a")).toBe(true);
    expect(isAudioFile("song.wav")).toBe(true);
    expect(isAudioFile("song.aac")).toBe(true);
    expect(isAudioFile("song.ogg")).toBe(false);
    expect(isAudioFile("song.txt")).toBe(false);
  });
});
