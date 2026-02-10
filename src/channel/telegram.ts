/**
 * Telegram channel using grammY with long polling.
 */

import { Bot } from "grammy";
import { log } from "../logger";
import { formatProgress, type ProgressUpdate } from "../progress";

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

export function createTelegramChannel(opts: {
  token: string;
  onMessage: (
    chatId: string,
    text: string,
    onProgress: (u: ProgressUpdate) => Promise<void>,
  ) => Promise<string>;
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

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const text = ctx.message.text;
    log.info("telegram", "Message received", { chatId, preview: text.slice(0, 100) });

    // Acknowledge receipt immediately (before any locks)
    await ctx.react("👀").catch(() => {});

    return withChatLock(chatId, async () => {
      // Send typing indicator
      await ctx.replyWithChatAction("typing");
      const typingInterval = setInterval(() => {
        ctx.replyWithChatAction("typing").catch(() => {});
      }, 4000);

      // Progress status message (suppressed for the first 5s)
      let statusMessageId: number | null = null;
      let lastEditTime = 0;
      const progressStart = Date.now();
      const numericChatId = ctx.chat.id;

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
        const response = await opts.onMessage(chatId, text, onProgress);
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
        log.error("telegram", "Error handling message", { chatId, error: String(err) });
        await ctx.reply("Sorry, something went wrong. Check the logs for details.");
      }
    });
  });

  return {
    async start() {
      log.info("telegram", "Bot starting");
      bot.start({
        onStart: (botInfo) => {
          log.info("telegram", "Bot running", { username: botInfo.username });
        },
      });
    },

    stop() {
      bot.stop();
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
