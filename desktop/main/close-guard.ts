/**
 * Close handling for the workspace window, as a small state machine with
 * injected effects so it is unit tested without Electron.
 *
 * The signal: the workspace page already registers a `beforeunload` handler
 * whenever writes are pending or a save failed (src/app/project/[id]/page.tsx).
 * Electron reports a blocked unload as `will-prevent-unload`. The guard then:
 *   1. waits — re-requesting close every CLOSE_POLL_INTERVAL_MS, so the window
 *      closes by itself as soon as the page's queued local commits settle;
 *   2. after CLOSE_SETTLE_WINDOW_MS still blocked, asks the estimator:
 *      wait and try again / keep editing / close without saving;
 *   3. only an explicit "close without saving" overrides the page, and that
 *      choice is labelled as possibly losing unsaved edits.
 * It never waits on cloud sync or optional backups: only the page's own
 * local-commit signal is consulted.
 */

export type CloseChoice = "wait" | "keep-editing" | "discard";
export type CloseGuardState = "idle" | "waiting" | "asking" | "forcing";

export interface CloseGuardEffects {
  /** Ask the window to close again (runs the page's beforeunload). */
  requestClose(): void;
  /** Show the choice to the estimator. */
  ask(): Promise<CloseChoice>;
  now(): number;
  schedule(callback: () => void, delayMs: number): () => void;
  onState?(state: CloseGuardState): void;
  log?(message: string): void;
}

export interface CloseGuardTiming {
  readonly settleWindowMs: number;
  readonly pollIntervalMs: number;
}

export class CloseGuard {
  private state: CloseGuardState = "idle";
  private waitStartedAt = 0;
  private cancelTimer: (() => void) | null = null;

  constructor(
    private readonly effects: CloseGuardEffects,
    private readonly timing: CloseGuardTiming
  ) {}

  get current(): CloseGuardState {
    return this.state;
  }

  /**
   * Called when the page blocked an unload. Returns true when the unload
   * should proceed anyway (the estimator chose to discard), false to keep the
   * window open.
   */
  onUnloadBlocked(): boolean {
    switch (this.state) {
      case "forcing":
        this.effects.log?.("close: proceeding without waiting for unsaved changes (estimator's choice)");
        return true;
      case "idle":
        this.effects.log?.("close: the page reports unsaved changes; waiting for local saves");
        this.setState("waiting");
        this.waitStartedAt = this.effects.now();
        this.schedulePoll();
        return false;
      case "waiting":
        if (this.effects.now() - this.waitStartedAt >= this.timing.settleWindowMs) {
          void this.askEstimator();
        } else {
          this.schedulePoll();
        }
        return false;
      case "asking":
        return false;
    }
  }

  /** The window closed or was destroyed; drop any pending retry. */
  dispose(): void {
    this.clearTimer();
    this.state = "idle";
  }

  private async askEstimator(): Promise<void> {
    this.clearTimer();
    this.setState("asking");
    let choice: CloseChoice;
    try {
      choice = await this.effects.ask();
    } catch {
      choice = "keep-editing";
    }
    this.effects.log?.(`close: estimator chose ${choice}`);
    if (this.state !== "asking") return;
    if (choice === "wait") {
      this.setState("waiting");
      this.waitStartedAt = this.effects.now();
      this.effects.requestClose();
    } else if (choice === "discard") {
      this.setState("forcing");
      this.effects.requestClose();
    } else {
      this.setState("idle");
    }
  }

  private schedulePoll(): void {
    this.clearTimer();
    this.cancelTimer = this.effects.schedule(() => {
      this.cancelTimer = null;
      if (this.state === "waiting") this.effects.requestClose();
    }, this.timing.pollIntervalMs);
  }

  private clearTimer(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private setState(state: CloseGuardState): void {
    this.state = state;
    this.effects.onState?.(state);
  }
}
