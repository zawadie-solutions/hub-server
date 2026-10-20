/** Small async building blocks shared by the two background job managers. */

/** Like threading.Event: wait() resolves at once while open, otherwise when next opened. */
export class Gate {
  private isOpen = true;
  private waiters: (() => void)[] = [];

  open(): void {
    this.isOpen = true;
    for (const w of this.waiters.splice(0)) w();
  }

  close(): void {
    this.isOpen = false;
  }

  wait(): Promise<void> {
    return this.isOpen ? Promise.resolve() : new Promise((resolve) => this.waiters.push(resolve));
  }
}

/** Runs control operations (start/pause/resume/stop) one at a time, in call order. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

/** A bad request: nothing to do (HTTP 400). */
export class JobInputError extends Error {}
/** A job is already active (HTTP 409). */
export class JobConflictError extends Error {}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
