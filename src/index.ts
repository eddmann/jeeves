/**
 * Jeeves — Personal AI assistant entry point.
 */

import { join, resolve } from "path";
import { createInterface } from "readline";
import { AuthStorage } from "./auth/storage";
import { loginAnthropic } from "./auth/oauth";
import { loadWorkspaceFiles, initWorkspace, loadWorkspaceEnv } from "./workspace/loader";
import { loadSkillsFromDirs } from "./skills/loader";
import { allTools } from "./tools/index";
import { CronScheduler } from "./cron/scheduler";
import { SessionStore } from "./session";
import { runAgent, type AgentContext } from "./agent";
import { HeartbeatRunner } from "./heartbeat";
import { createTelegramChannel } from "./channel/telegram";
import { initLogger, log, formatError } from "./logger";
import { MemoryIndex } from "./memory/index";
import { createOpenAIEmbedder, createNoOpEmbedder } from "./memory/embeddings";
import { createTranscriber } from "./transcribe";
import { withAgentLock } from "./agent-lock";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const rootDir = process.cwd();
  const workspaceDir = process.env.WORKSPACE_DIR
    ? resolve(process.env.WORKSPACE_DIR)
    : join(rootDir, "workspace");
  const authPath = join(rootDir, "auth.json");
  const authStorage = new AuthStorage(authPath);

  // CLI commands
  if (command === "login") {
    if (args.includes("--api-key")) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const key = await new Promise<string>((res) => {
        rl.question("Enter your Anthropic API key: ", (answer) => {
          rl.close();
          res(answer.trim());
        });
      });
      await authStorage.saveApiKey(key);
      console.log("API key saved to auth.json");
      return;
    }

    // OAuth PKCE flow
    console.log("Starting OAuth login...");
    const tokens = await loginAnthropic(
      (url) => {
        console.log("\nOpen this URL in your browser:\n");
        console.log(url);
        console.log();
      },
      async () => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        return new Promise<string>((res) => {
          rl.question("Paste the authorization code: ", (answer) => {
            rl.close();
            res(answer.trim());
          });
        });
      },
    );
    await authStorage.saveOAuth(tokens);
    console.log("OAuth login successful! Tokens saved.");
    return;
  }

  if (command === "logout") {
    authStorage.logout();
    console.log("Logged out. auth.json deleted.");
    return;
  }

  if (command === "status") {
    const hasAuth = authStorage.hasAuth();
    const isOAuth = authStorage.isOAuth();
    const skillDirs = [join(rootDir, "skills"), join(workspaceDir, "skills")];
    const skills = loadSkillsFromDirs(skillDirs);
    const hasTelegram = !!process.env.TELEGRAM_BOT_TOKEN;

    console.log("Jeeves Status");
    console.log("─".repeat(40));
    console.log(`Auth:      ${hasAuth ? (isOAuth ? "OAuth" : "API Key") : "Not configured"}`);
    console.log(`Workspace: ${workspaceDir}`);
    console.log(`Skills:    ${skills.length} loaded`);
    console.log(`Telegram:  ${hasTelegram ? "Configured" : "Not configured"}`);
    return;
  }

  // Default: run mode
  if (!authStorage.hasAuth()) {
    console.error(
      "No authentication configured.\n" +
        "Run `bun dev login` for OAuth or `bun dev login --api-key` for API key.\n" +
        "Or set ANTHROPIC_API_KEY in .env",
    );
    process.exit(1);
  }

  // Initialize logger
  const logLevel = (process.env.LOG_LEVEL ?? "info") as "debug" | "info" | "warn" | "error";
  const logDir = join(workspaceDir, "logs");
  initLogger(logLevel, logDir);

  // Initialize workspace
  const templateDir = join(rootDir, "src", "workspace", "templates");
  initWorkspace(workspaceDir, templateDir);
  loadWorkspaceEnv(workspaceDir);

  // Load workspace files
  const workspaceFiles = loadWorkspaceFiles(workspaceDir);

  // Skill directories
  const skillDirs = [join(rootDir, "skills"), join(workspaceDir, "skills")];

  // Create session store
  const sessionStore = new SessionStore(join(workspaceDir, "sessions"));

  // Initialize memory index
  const openaiKey = process.env.OPENAI_API_KEY;
  const embedder = openaiKey ? createOpenAIEmbedder(openaiKey) : createNoOpEmbedder();
  const memoryIndex = new MemoryIndex(
    join(workspaceDir, "memory", "index.sqlite"),
    embedder,
    workspaceDir,
  );
  await memoryIndex.sync();
  await memoryIndex.indexSessionFiles(join(workspaceDir, "sessions"));
  const transcribe = openaiKey ? createTranscriber(openaiKey) : undefined;
  log.info("startup", "Memory index initialized", {
    mode: openaiKey ? "semantic + keyword" : "keyword-only",
  });

  // Create cron scheduler
  const cronScheduler = new CronScheduler({
    storePath: join(workspaceDir, "cron", "jobs.json"),
    onJobDue: async (job) => {
      await withAgentLock(async () => {
        const ctx = makeAgentContext(`cron_${job.id}`);
        const response = await runAgent(ctx, job.message);
        // Send cron output to channel if configured
        if (channel && chatId) {
          await channel.send(chatId, `[Cron: ${job.name}]\n${response}`);
        }
      });
    },
  });

  // Create tools (needs cron scheduler)
  const tools = allTools({ cronScheduler, workspaceDir, memoryIndex });

  // Helper to create agent context — reloads skills fresh each run
  function makeAgentContext(sessionKey: string): AgentContext {
    return {
      authStorage,
      tools,
      skills: loadSkillsFromDirs(skillDirs),
      workspaceFiles,
      sessionStore,
      sessionKey,
      memoryIndex,
    };
  }

  // Telegram channel
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  let channel: ReturnType<typeof createTelegramChannel> | null = null;

  if (telegramToken) {
    channel = createTelegramChannel({
      token: telegramToken,
      transcribe,
      onMessage: async (msgChatId, content, onProgress) => {
        return withAgentLock(async () => {
          const ctx = makeAgentContext(`telegram_${msgChatId}`);
          return runAgent(ctx, content, onProgress);
        });
      },
    });
  }

  // Heartbeat
  const heartbeatIntervalMs =
    (parseInt(process.env.HEARTBEAT_INTERVAL_MINUTES ?? "30", 10) || 30) * 60 * 1000;

  const heartbeat = new HeartbeatRunner({
    intervalMs: heartbeatIntervalMs,
    workspaceDir,
    runAgent: async (message) => {
      return withAgentLock(async () => {
        const ctx = makeAgentContext("heartbeat");
        return runAgent(ctx, message);
      });
    },
    sendToChannel: async (text) => {
      if (channel && chatId) {
        await channel.send(chatId, text);
      }
    },
    activeHours: {
      start: process.env.HEARTBEAT_ACTIVE_START ?? "08:00",
      end: process.env.HEARTBEAT_ACTIVE_END ?? "23:00",
    },
  });

  // Start everything
  cronScheduler.start();
  heartbeat.start();
  if (channel) {
    await channel.start();
  }

  console.log("\nJeeves is running.");
  console.log(`  Workspace: ${workspaceDir}`);
  console.log(`  Skills: ${loadSkillsFromDirs(skillDirs).length} loaded`);
  console.log(`  Telegram: ${channel ? "active" : "not configured"}`);
  console.log(`  Heartbeat: every ${heartbeatIntervalMs / 60000}min`);
  console.log(`  Cron jobs: ${cronScheduler.listJobs().length}`);
  console.log(`  Memory: active (${openaiKey ? "semantic + keyword" : "keyword-only"})`);
  console.log();
  log.info("startup", "Jeeves is running", {
    workspace: workspaceDir,
    skills: loadSkillsFromDirs(skillDirs).length,
    telegram: channel ? "active" : "not configured",
    heartbeat: `${heartbeatIntervalMs / 60000}min`,
    cronJobs: cronScheduler.listJobs().length,
    logLevel,
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    log.info("startup", "Shutting down");
    heartbeat.stop();
    cronScheduler.stop();
    if (channel) channel.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error("startup", "Fatal error", formatError(err));
  process.exit(1);
});
