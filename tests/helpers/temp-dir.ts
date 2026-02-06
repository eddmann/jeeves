import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export function createTempDir(prefix = "jeeves-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
