import { describe, expect, test } from "bun:test";
import { createAttachTool } from "../src/tools/attach";

describe("attach tool", () => {
  test("pushes path onto attachments array", async () => {
    const attachments: string[] = [];
    const tool = createAttachTool({ attachments });

    await tool.execute({ path: "outbox/chart.png" });

    expect(attachments).toEqual(["outbox/chart.png"]);
  });

  test("accumulates multiple attachments", async () => {
    const attachments: string[] = [];
    const tool = createAttachTool({ attachments });

    await tool.execute({ path: "outbox/chart.png" });
    await tool.execute({ path: "outbox/data.csv" });
    await tool.execute({ path: "outbox/voice.ogg" });

    expect(attachments).toEqual(["outbox/chart.png", "outbox/data.csv", "outbox/voice.ogg"]);
  });

  test("returns confirmation with filename", async () => {
    const tool = createAttachTool({ attachments: [] });

    const result = await tool.execute({ path: "outbox/report.pdf" });

    expect(result).toBe("Attached report.pdf");
  });

  test("handles paths with directories", async () => {
    const tool = createAttachTool({ attachments: [] });

    const result = await tool.execute({ path: "outbox/charts/weekly.png" });

    expect(result).toBe("Attached weekly.png");
  });
});
