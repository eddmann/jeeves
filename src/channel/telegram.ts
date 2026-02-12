/**
 * Telegram channel using grammY with long polling.
 */

import { Bot, type Context } from "grammy";
import { run, type RunnerHandle } from "@grammyjs/runner";
import { log, formatError } from "../logger";
import { formatProgress, type ProgressUpdate } from "../progress";
import type { LLMContentBlock } from "../llm";
import type { TranscribeFn } from "../transcribe";

export interface Channel {
  start(): Promise<void>;
  stop(): void;
  send(chatId: string, text: string): Promise<void>;
}

export const MAX_MESSAGE_LENGTH = 4096;

/**
 * Convert Markdown to Telegram-compatible HTML.
 * Handles: bold, italic, code, code blocks, links, headers.
 */
export function markdownToTelegramHTML(md: string): string {
  let text = md;

  // Escape HTML entities first (but we'll unescape our own tags after)
  text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Code blocks: ```lang\n...\n``` → <pre>...</pre>
  text = text.replace(/```(?:\w*)\n([\s\S]*?)```/g, (_m, code) => `<pre>${code.trim()}</pre>`);

  // Inline code: `...` → <code>...</code>
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Headers: ## text → <b>text</b>
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // Bold: **text** → <b>text</b>
  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // Italic: *text* → <i>text</i> (but not inside bold tags)
  text = text.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, "<i>$1</i>");

  // Links: [text](url) → <a href="url">text</a>
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  return text;
}

/**
 * Split a message into chunks that fit within Telegram's message size limit.
 */
export function splitMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf("\n", MAX_MESSAGE_LENGTH);
    if (splitIdx < MAX_MESSAGE_LENGTH / 2) {
      // No good newline, split at space
      splitIdx = remaining.lastIndexOf(" ", MAX_MESSAGE_LENGTH);
    }
    if (splitIdx < MAX_MESSAGE_LENGTH / 2) {
      // No good split point, hard split
      splitIdx = MAX_MESSAGE_LENGTH;
    }
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
}

export function getReplyContext(replyMsg: unknown): string | null {
  const msg = replyMsg as { text?: string; caption?: string } | undefined;
  if (!msg) return null;
  const text = msg.text ?? msg.caption;
  if (!text) return null;
  const preview = text.length > 300 ? text.slice(0, 300) + "..." : text;
  return `[Replying to: ${preview}]`;
}

export function createTelegramChannel(opts: {
  token: string;
  onMessage: (
    chatId: string,
    content: string | LLMContentBlock[],
    onProgress: (u: ProgressUpdate) => Promise<void>,
  ) => Promise<string>;
  transcribe?: TranscribeFn;
}): Channel {
  const bot = new Bot(opts.token);

  // Per-chat mutex to prevent concurrent agent runs
  const chatLocks = new Map<string, Promise<void>>();

  function withChatLock(chatId: string, fn: () => Promise<void>): Promise<void> {
    const prev = chatLocks.get(chatId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    chatLocks.set(chatId, next);
    next.then(
      () => {
        if (chatLocks.get(chatId) === next) chatLocks.delete(chatId);
      },
      () => {
        if (chatLocks.get(chatId) === next) chatLocks.delete(chatId);
      },
    );
    return next;
  }

  async function sendFormatted(
    sendFn: (text: string, opts: { parse_mode: string }) => Promise<unknown>,
    text: string,
  ): Promise<void> {
    const html = markdownToTelegramHTML(text);
    const chunks = splitMessage(html);
    for (const chunk of chunks) {
      try {
        await sendFn(chunk, { parse_mode: "HTML" });
      } catch {
        // If HTML parsing fails, fall back to plain text
        await sendFn(chunk, { parse_mode: "" as never });
      }
    }
  }

  async function downloadFile(fileId: string): Promise<Buffer> {
    const file = await bot.api.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${opts.token}/${file.file_path}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  // Shared handler for all incoming message types
  async function handleIncoming(
    ctx: Context,
    content: string | LLMContentBlock[],
    logPreview: string,
  ): Promise<void> {
    const chatId = ctx.chat!.id.toString();
    log.info("telegram", "Message received", { chatId, preview: logPreview });

    // Acknowledge receipt if the agent is already busy on this chat
    if (chatLocks.has(chatId)) {
      await ctx.react("👀").catch(() => {});
    }

    return withChatLock(chatId, async () => {
      const messageStart = Date.now();

      // Send typing indicator
      await ctx.replyWithChatAction("typing");
      const typingInterval = setInterval(() => {
        ctx.replyWithChatAction("typing").catch(() => {});
      }, 4000);

      // Progress status message (suppressed for the first 5s)
      let statusMessageId: number | null = null;
      let lastEditTime = 0;
      const progressStart = Date.now();
      const numericChatId = ctx.chat!.id;

      const onProgress = async (update: ProgressUpdate): Promise<void> => {
        const now = Date.now();
        if (now - progressStart < 5000) return;
        const progressText = formatProgress(update);
        try {
          if (statusMessageId === null) {
            const msg = await bot.api.sendMessage(numericChatId, progressText);
            statusMessageId = msg.message_id;
            lastEditTime = now;
          } else if (now - lastEditTime >= 1000) {
            await bot.api.editMessageText(numericChatId, statusMessageId, progressText);
            lastEditTime = now;
          }
        } catch {
          // Silently ignore Telegram API errors for status updates
        }
      };

      try {
        const response = await opts.onMessage(chatId, content, onProgress);
        clearInterval(typingInterval);

        // Delete status message
        if (statusMessageId !== null) {
          try {
            await bot.api.deleteMessage(numericChatId, statusMessageId);
          } catch {
            // Silently ignore
          }
        }

        const html = markdownToTelegramHTML(response);
        const chunks = splitMessage(html);
        log.info("telegram", "Response sent", {
          chatId,
          chars: response.length,
          chunks: chunks.length,
          ms: Date.now() - messageStart,
        });
        await sendFormatted((t, o) => ctx.reply(t, o as Parameters<typeof ctx.reply>[1]), response);
      } catch (err) {
        clearInterval(typingInterval);
        if (statusMessageId !== null) {
          try {
            await bot.api.deleteMessage(numericChatId, statusMessageId);
          } catch {
            // Silently ignore
          }
        }
        log.error("telegram", "Error handling message", {
          chatId,
          ms: Date.now() - messageStart,
          ...formatError(err),
        });
        const errMsg = err instanceof Error ? err.message : String(err);
        await ctx.reply(`Something went wrong: ${errMsg}`);
      }
    });
  }

  // Text messages
  bot.on("message:text", (ctx) => {
    const reply = getReplyContext(ctx.message.reply_to_message);
    const text = reply ? `${reply}\n\n${ctx.message.text}` : ctx.message.text;
    return handleIncoming(ctx, text, ctx.message.text.slice(0, 100));
  });

  // Photo messages
  bot.on("message:photo", async (ctx) => {
    try {
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];
      const buffer = await downloadFile(largest.file_id);
      const base64 = buffer.toString("base64");

      const reply = getReplyContext(ctx.message.reply_to_message);
      const content: LLMContentBlock[] = [
        ...(reply ? [{ type: "text" as const, text: reply }] : []),
        {
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: base64 },
        },
        { type: "text", text: ctx.message.caption || "The user sent this image." },
      ];

      return handleIncoming(ctx, content, ctx.message.caption?.slice(0, 100) || "[photo]");
    } catch (err) {
      log.error("telegram", "Failed to process photo", formatError(err));
      await ctx.reply("Sorry, I couldn't process that image.");
    }
  });

  // Voice and audio messages
  bot.on(["message:voice", "message:audio"], async (ctx) => {
    if (!opts.transcribe) {
      await ctx.reply(
        "Voice messages require an OpenAI API key for transcription. " +
          "Set OPENAI_API_KEY in your .env file to enable this feature.",
      );
      return;
    }

    try {
      const fileId = ctx.message.voice?.file_id ?? ctx.message.audio?.file_id;
      if (!fileId) return;

      const buffer = await downloadFile(fileId);
      const filename = ctx.message.voice
        ? "voice.ogg"
        : (ctx.message.audio?.file_name ?? "audio.ogg");
      const transcript = await opts.transcribe(buffer, filename);

      const reply = getReplyContext(ctx.message.reply_to_message);
      const prefix = reply ? `${reply}\n\n` : "";
      const text = `${prefix}[Voice message transcript]\n${transcript}`;
      return handleIncoming(ctx, text, transcript.slice(0, 100));
    } catch (err) {
      log.error("telegram", "Failed to process voice message", formatError(err));
      await ctx.reply("Sorry, I couldn't process that voice message.");
    }
  });

  // Fallback for unsupported message types
  bot.on("message", async (ctx) => {
    await ctx.reply(
      "I can handle text, photos, and voice messages. " + "This message type isn't supported yet.",
    );
  });

  let handle: RunnerHandle | null = null;

  return {
    async start() {
      log.info("telegram", "Bot starting");
      await bot.init();
      log.info("telegram", "Bot running", { username: bot.botInfo.username });
      handle = run(bot);
    },

    stop() {
      handle?.stop();
    },

    async send(chatId: string, text: string) {
      const html = markdownToTelegramHTML(text);
      const chunks = splitMessage(html);
      for (const chunk of chunks) {
        try {
          await bot.api.sendMessage(chatId, chunk, { parse_mode: "HTML" });
        } catch {
          await bot.api.sendMessage(chatId, chunk);
        }
      }
    },
  };
}
