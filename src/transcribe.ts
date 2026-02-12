/**
 * Audio transcription via OpenAI Whisper API.
 */

import OpenAI from "openai";

export type TranscribeFn = (audio: Buffer, filename: string) => Promise<string>;

const TIMEOUT_MS = 30_000;

export function createTranscriber(apiKey: string): TranscribeFn {
  const client = new OpenAI({ apiKey, timeout: TIMEOUT_MS });

  return async (audio: Buffer, filename: string): Promise<string> => {
    const file = new File([audio], filename, { type: "audio/ogg" });
    const response = await client.audio.transcriptions.create({
      model: "whisper-1",
      file,
    });
    return response.text;
  };
}
