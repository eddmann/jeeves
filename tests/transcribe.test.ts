import { describe, test, expect, afterEach, mock } from "bun:test";
import { createTranscriber } from "../src/transcribe";

describe("createTranscriber", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns transcript text from Whisper API", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ text: "Hello, this is a test." }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const transcribe = createTranscriber("test-api-key");
    const audio = Buffer.from("fake-audio-data");
    const result = await transcribe(audio, "voice.ogg");

    expect(result).toBe("Hello, this is a test.");
  });

  test("passes audio data to OpenAI API endpoint", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify({ text: "transcribed" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const transcribe = createTranscriber("test-key");
    await transcribe(Buffer.from("audio"), "test.ogg");

    expect(capturedUrl).toContain("audio/transcriptions");
  });

  test("throws on API error", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ error: { message: "Invalid API key" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const transcribe = createTranscriber("bad-key");
    const audio = Buffer.from("fake-audio");

    expect(transcribe(audio, "voice.ogg")).rejects.toThrow();
  });
});
