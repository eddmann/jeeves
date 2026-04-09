/**
 * Telegram channel using grammY with long polling.
 */

import { resolve } from "path";
import { Bot, InputFile, type Context } from "grammy";
import { run, type RunnerHandle } from "@grammyjs/runner";
import { log, formatError } from "../logger";
import { formatProgress, type ProgressUpdate } from "../progress";
import type { LLMContentBlock } from "../llm";
import type { AgentResult } from "../agent";
import type { TranscribeFn } from "../transcribe";
import { isImageFile, isVoiceFile, isAudioFile } from "../media";

export interface Channel {
  start(): Promise<void>;
  stop(): void;
  send(chatId: string, text: string, attachments: string[]): Promise<void>;
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

  // Markdown tables → aligned monospace <pre> blocks
  text = text.replace(/((?:^|\n)\|[^\n]+\|(?:\n\|[^\n]+\|)*)/g, (tableBlock) => {
    const rows = tableBlock.trim().split("\n");
    // Filter out separator rows (|---|---|)
    const dataRows = rows.filter((r) => !/^\|[\s-:|]+\|$/.test(r));
    if (dataRows.length === 0) return tableBlock;
    // Parse cells
    const parsed = dataRows.map((r) =>
      r
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim()),
    );
    // Calculate column widths
    const colWidths = parsed[0].map((_, ci) =>
      Math.max(...parsed.map((row) => (row[ci] ?? "").length)),
    );
    // Format rows with padding
    const formatted = parsed.map((row) =>
      row.map((cell, ci) => cell.padEnd(colWidths[ci])).join("  "),
    );
    return `\n<pre>${formatted.join("\n")}</pre>\n`;
  });

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

/** Returns tag names that are open (unclosed) at the end of an HTML string. */
function unclosedTags(html: string): string[] {
  const stack: string[] = [];
  for (const m of html.matchAll(/<\/?([a-z]+)(?:\s[^>]*)?>/gi)) {
    if (m[0][1] === "/") {
      const idx = stack.lastIndexOf(m[1].toLowerCase());
      if (idx !== -1) stack.splice(idx, 1);
    } else {
      stack.push(m[1].toLowerCase());
    }
  }
  return stack;
}

// Telegram tags are short (b, i, a, code, pre) — 50 chars covers worst-case nesting.
const TAG_OVERHEAD = 50;

/**
 * Split a message into chunks ≤ MAX_MESSAGE_LENGTH with balanced HTML tags.
 */
export function splitMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;
  let carry: string[] = [];

  while (remaining.length > 0) {
    const prefix = carry.map((t) => `<${t}>`).join("");
    const body = prefix + remaining;

    if (body.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(body);
      break;
    }

    const budget = MAX_MESSAGE_LENGTH - TAG_OVERHEAD;
    let splitIdx = body.lastIndexOf("\n", budget);
    if (splitIdx < budget / 2) splitIdx = body.lastIndexOf(" ", budget);
    if (splitIdx < budget / 2) splitIdx = budget;

    const chunk = body.slice(0, splitIdx);
    const open = unclosedTags(chunk);
    const closers = [...open]
      .reverse()
      .map((t) => `</${t}>`)
      .join("");

    chunks.push(chunk + closers);
    remaining = body.slice(splitIdx).trimStart();
    carry = open;
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
  workspaceDir: string;
  onMessage: (
    chatId: string,
    content: string | LLMContentBlock[],
    onProgress: (u: ProgressUpdate) => Promise<void>,
  ) => Promise<AgentResult>;
  transcribe?: TranscribeFn;
}): Channel {
  const bot = new Bot(opts.token);

  // Reject messages from unauthorized chats
  const allowedChatId = process.env.TELEGRAM_CHAT_ID;
  if (allowedChatId) {
    bot.use((ctx, next) => {
      const chatId = ctx.chat?.id.toString();
      if (chatId !== allowedChatId) {
        log.warn("telegram", "Unauthorized chat", { chatId });
        return;
      }
      return next();
    });
  }

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

  async function sendAttachment(chatId: string, filePath: string): Promise<void> {
    const fullPath = resolve(opts.workspaceDir, filePath);
    try {
      if (isImageFile(filePath)) {
        await bot.api.sendPhoto(chatId, new InputFile(fullPath));
      } else if (isVoiceFile(filePath)) {
        await bot.api.sendVoice(chatId, new InputFile(fullPath));
      } else if (isAudioFile(filePath)) {
        await bot.api.sendAudio(chatId, new InputFile(fullPath));
      } else {
        await bot.api.sendDocument(chatId, new InputFile(fullPath));
      }
      log.info("telegram", "Attachment sent", { chatId, path: filePath });
    } catch (err) {
      log.error("telegram", "Failed to send attachment", {
        path: filePath,
        ...formatError(err),
      });
    }
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
      const onProgress = async (update: ProgressUpdate): Promise<void> => {
        const now = Date.now();
        if (now - progressStart < 5000) return;
        const progressText = formatProgress(update);
        try {
          if (statusMessageId === null) {
            const msg = await bot.api.sendMessage(chatId, progressText);
            statusMessageId = msg.message_id;
            lastEditTime = now;
          } else if (now - lastEditTime >= 1000) {
            await bot.api.editMessageText(chatId, statusMessageId, progressText);
            lastEditTime = now;
          }
        } catch {
          // Silently ignore Telegram API errors for status updates
        }
      };

      try {
        const result = await opts.onMessage(chatId, content, onProgress);
        clearInterval(typingInterval);

        // Delete status message
        if (statusMessageId !== null) {
          try {
            await bot.api.deleteMessage(chatId, statusMessageId);
          } catch {
            // Silently ignore
          }
        }

        log.info("telegram", "Response sent", {
          chatId,
          chars: result.text.length,
          attachments: result.attachments.length,
          ms: Date.now() - messageStart,
        });
        if (result.text) {
          await sendFormatted(
            (t, o) => ctx.reply(t, o as Parameters<typeof ctx.reply>[1]),
            result.text,
          );
        }

        // Send attachments
        for (const filePath of result.attachments) {
          await sendAttachment(chatId, filePath);
        }
      } catch (err) {
        clearInterval(typingInterval);
        if (statusMessageId !== null) {
          try {
            await bot.api.deleteMessage(chatId, statusMessageId);
          } catch {
            // Silently ignore
          }
        }
        log.error("telegram", "Error handling message", {
          chatId,
          ms: Date.now() - messageStart,
          ...formatError(err),
        });
        await ctx.reply(
          "I regret to report a difficulty has arisen, sir. Perhaps another attempt?",
        );
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
          dataUri: `data:image/jpeg;base64,${base64}`,
        },
        { type: "text", text: ctx.message.caption || "The user sent this image." },
      ];

      return handleIncoming(ctx, content, ctx.message.caption?.slice(0, 100) || "[photo]");
    } catch (err) {
      log.error("telegram", "Failed to process photo", formatError(err));
      await ctx.reply(
        "I'm afraid the image proved somewhat uncooperative. Might I trouble you to send it again?",
      );
    }
  });

  // Voice and audio messages
  bot.on(["message:voice", "message:audio"], async (ctx) => {
    if (!opts.transcribe) {
      await ctx.reply("I regret that voice messages are not presently available, sir.");
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
      await ctx.reply(
        "The voice message, I'm afraid, eluded me. Would you be so kind as to try again, or perhaps put it in writing?",
      );
    }
  });

  // Fallback for unsupported message types
  bot.on("message", async (ctx) => {
    await ctx.reply(
      "I'm equipped to receive text, photographs, and voice messages, sir. " +
        "This particular format is beyond my present capabilities.",
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

    async send(chatId: string, text: string, attachments: string[]) {
      const html = markdownToTelegramHTML(text);
      const chunks = splitMessage(html);
      for (const chunk of chunks) {
        try {
          await bot.api.sendMessage(chatId, chunk, { parse_mode: "HTML" });
        } catch {
          await bot.api.sendMessage(chatId, chunk);
        }
      }
      for (const filePath of attachments) {
        await sendAttachment(chatId, filePath);
      }
    },
  };
}
