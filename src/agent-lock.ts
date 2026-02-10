/**
 * Agent mutex — prevents overlapping agent runs.
 * Rejects with a timeout error if the lock can't be acquired within 3 minutes.
 */

export const AGENT_LOCK_TIMEOUT_MS = 3 * 60 * 1000;

let agentLock = Promise.resolve();
let timeoutMs = AGENT_LOCK_TIMEOUT_MS;

export function withAgentLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = agentLock;
  let resolve!: () => void;
  agentLock = new Promise((r) => (resolve = r));

  return new Promise<T>((res, rej) => {
    const timer = setTimeout(() => {
      rej(new Error("Agent is busy — please try again in a moment."));
    }, timeoutMs);

    prev
      .then(fn)
      .then(
        (val) => {
          clearTimeout(timer);
          res(val);
        },
        (err) => {
          clearTimeout(timer);
          rej(err);
        },
      )
      .finally(() => resolve());
  });
}

/** Reset the lock state — for testing only. */
export function resetAgentLock(overrideTimeoutMs?: number): void {
  agentLock = Promise.resolve();
  timeoutMs = overrideTimeoutMs ?? AGENT_LOCK_TIMEOUT_MS;
}
