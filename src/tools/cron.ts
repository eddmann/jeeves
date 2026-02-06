/**
 * Agent-facing cron tool for managing scheduled jobs.
 */

import type { CronScheduler } from "../cron/scheduler";
import type { Tool } from "./index";

export function createCronTool(scheduler: CronScheduler): Tool {
  return {
    name: "cron",
    description:
      "Manage scheduled jobs. Actions: add (create a new job), list (show all jobs), remove (delete a job), run (force-fire a job), status (show scheduler status).",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["add", "list", "remove", "run", "status"],
          description: "The action to perform",
        },
        // For "add"
        name: {
          type: "string",
          description: "Job name (for add)",
        },
        message: {
          type: "string",
          description: "Prompt to send to the agent when the job fires (for add)",
        },
        schedule_type: {
          type: "string",
          enum: ["at", "every", "cron"],
          description:
            "Schedule type: 'at' (one-time ISO date), 'every' (interval ms), 'cron' (cron expression)",
        },
        schedule_value: {
          type: "string",
          description:
            "Schedule value: ISO 8601 date for 'at', milliseconds for 'every', cron expression for 'cron'",
        },
        timezone: {
          type: "string",
          description: "Timezone for cron schedule (e.g. 'America/New_York')",
        },
        delete_after_run: {
          type: "boolean",
          description: "Delete the job after it fires (default: false, true for 'at' schedules)",
        },
        // For "remove" and "run"
        id: {
          type: "string",
          description: "Job ID (for remove/run)",
        },
      },
      required: ["action"],
    },
    async execute(input) {
      const action = input.action as string;

      switch (action) {
        case "add": {
          const name = input.name as string;
          const message = input.message as string;
          const schedType = input.schedule_type as string;
          const schedValue = input.schedule_value as string;
          const tz = input.timezone as string | undefined;

          if (!name || !message || !schedType || !schedValue) {
            return "Error: name, message, schedule_type, and schedule_value are required for add";
          }

          let schedule:
            | { kind: "at"; at: string }
            | { kind: "every"; everyMs: number }
            | { kind: "cron"; expr: string; tz?: string };

          if (schedType === "at") {
            schedule = { kind: "at", at: schedValue };
          } else if (schedType === "every") {
            schedule = { kind: "every", everyMs: parseInt(schedValue, 10) };
          } else if (schedType === "cron") {
            schedule = { kind: "cron", expr: schedValue, tz };
          } else {
            return `Error: unknown schedule_type "${schedType}"`;
          }

          const deleteAfterRun = (input.delete_after_run as boolean) ?? schedType === "at";
          const job = scheduler.addJob({
            name,
            enabled: true,
            deleteAfterRun,
            schedule,
            message,
          });
          return `Created job "${job.name}" (id: ${job.id}), next run: ${new Date(job.nextRunAtMs ?? 0).toISOString()}`;
        }

        case "list": {
          const jobs = scheduler.listJobs();
          if (jobs.length === 0) return "No scheduled jobs.";
          return jobs
            .map(
              (j) =>
                `- ${j.name} (id: ${j.id}, ${j.enabled ? "enabled" : "disabled"}) schedule: ${JSON.stringify(j.schedule)}, next: ${j.nextRunAtMs ? new Date(j.nextRunAtMs).toISOString() : "n/a"}`,
            )
            .join("\n");
        }

        case "remove": {
          const id = input.id as string;
          if (!id) return "Error: id is required for remove";
          const removed = scheduler.removeJob(id);
          return removed ? `Removed job ${id}` : `Job ${id} not found`;
        }

        case "run": {
          const id = input.id as string;
          if (!id) return "Error: id is required for run";
          try {
            await scheduler.runJob(id);
            return `Triggered job ${id}`;
          } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`;
          }
        }

        case "status": {
          const jobs = scheduler.listJobs();
          const enabled = jobs.filter((j) => j.enabled).length;
          return `Scheduler running. ${jobs.length} jobs (${enabled} enabled).`;
        }

        default:
          return `Unknown action: ${action}`;
      }
    },
  };
}
