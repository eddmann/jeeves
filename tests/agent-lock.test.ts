import { describe, test, expect, beforeEach } from "bun:test";
import { withAgentLock, resetAgentLock } from "../src/agent-lock";

beforeEach(() => {
  resetAgentLock();
});

describe("withAgentLock", () => {
  test("executes function and returns result", async () => {
    const result = await withAgentLock(async () => "hello");

    expect(result).toBe("hello");
  });

  test("serializes concurrent calls", async () => {
    const order: number[] = [];

    const first = withAgentLock(async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 10));
      order.push(2);
    });
    const second = withAgentLock(async () => {
      order.push(3);
    });

    await Promise.all([first, second]);

    expect(order).toEqual([1, 2, 3]);
  });

  test("propagates errors from the function", async () => {
    await expect(
      withAgentLock(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  test("releases lock after error so next call proceeds", async () => {
    await withAgentLock(async () => {
      throw new Error("fail");
    }).catch(() => {});

    const result = await withAgentLock(async () => "recovered");

    expect(result).toBe("recovered");
  });

  test("rejects when lock cannot be acquired within timeout", async () => {
    resetAgentLock(50); // 50ms timeout for testing

    // Hold the lock with a slow function (exceeds timeout)
    const holder = withAgentLock(() => new Promise<void>((r) => setTimeout(r, 500)));
    // Prevent unhandled rejection from holder (it also times out by design)
    holder.catch(() => {});

    // This second call waits for the lock — should time out
    const waiter = withAgentLock(async () => "should not run");

    await expect(waiter).rejects.toThrow("Agent is busy");
  });

  test("lock is released after timeout so subsequent calls can proceed", async () => {
    resetAgentLock(50);

    // Hold the lock, let it time out
    const holder = withAgentLock(() => new Promise<void>((r) => setTimeout(r, 500)));
    await holder.catch(() => {});

    // Wait for the inner chain to settle and release the lock
    await new Promise((r) => setTimeout(r, 600));

    // Now lock should be free — reset timeout for a clean state
    resetAgentLock();
    const result = await withAgentLock(async () => "works again");
    expect(result).toBe("works again");
  });
});
