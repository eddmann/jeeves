// buns
// packages = ["@steipete/summarize"]

process.env.SUMMARIZE_GIT_SHA = process.env.SUMMARIZE_GIT_SHA || "buns";
process.argv = ["bun", "summarize", ...process.argv.slice(2)];
await import("@steipete/summarize/dist/esm/cli.js");
