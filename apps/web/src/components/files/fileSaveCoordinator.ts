import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";

export interface FileSaveCoordinatorOptions<A, E> {
  readonly debounceMs: number;
  readonly canPersist?: () => boolean;
  readonly persist: (contents: string) => Promise<AtomCommandResult<A, E>>;
  readonly onPendingChange: (pending: boolean) => void;
  /** Return false when another editor has newer unsaved contents. */
  readonly onConfirmed: (contents: string) => boolean | void;
  /** Called when a write pass ends with nothing further scheduled. */
  readonly onSettled?: () => void;
}

export class FileSaveCoordinator<A = unknown, E = unknown> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private latestContents = "";
  private latestRevision = 0;
  private confirmedRevision = 0;
  private lastChangeAt = 0;
  private saving = false;
  private disposed = false;
  private flushing = false;
  // T3 Zip: rename and delete in the Files panel wait for writes to finish, or drop them.
  private discarded = false;
  private settleWaiters: (() => void)[] = [];

  constructor(private readonly options: FileSaveCoordinatorOptions<A, E>) {}

  change(contents: string): void {
    if (this.disposed || this.discarded) return;
    this.latestContents = contents;
    this.latestRevision += 1;
    this.lastChangeAt = Date.now();
    this.options.onPendingChange(true);
    this.schedule(this.options.debounceMs);
  }

  /** The newest contents not yet written, which is the last write this coordinator will make. */
  get unconfirmedContents(): string | null {
    return this.discarded || this.latestRevision === this.confirmedRevision
      ? null
      : this.latestContents;
  }

  /** Writes the newest draft now instead of after the debounce, then any draft queued behind it. */
  flush(): void {
    this.clearTimer();
    this.flushing = true;
    void this.persistLatest();
  }

  /** T3 Zip: flushes and resolves once no write is running or scheduled. */
  flushAndSettle(): Promise<void> {
    const settled = new Promise<void>((resolve) => this.settleWaiters.push(resolve));
    this.flush();
    return settled;
  }

  /**
   * T3 Zip: drops the unsaved draft and every later edit, for a file that is being deleted.
   * Resolves once a write already sent has finished, so it cannot land after the delete.
   */
  discard(): Promise<void> {
    this.discarded = true;
    this.clearTimer();
    this.options.onPendingChange(false);
    return this.flushAndSettle();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    if (this.latestRevision > 0) void this.persistLatest();
  }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.persistLatest();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private async persistLatest(): Promise<void> {
    if (this.saving) return;
    if (
      this.discarded ||
      this.latestRevision === this.confirmedRevision ||
      this.options.canPersist?.() === false
    ) {
      this.settle();
      return;
    }

    this.saving = true;
    const contents = this.latestContents;
    const revision = this.latestRevision;
    const result = await this.options.persist(contents);
    const succeeded = result._tag === "Success";
    let confirmed = false;
    if (succeeded) {
      this.confirmedRevision = revision;
      confirmed = this.options.onConfirmed(contents) !== false;
    }

    this.saving = false;
    if (revision === this.latestRevision) {
      if (confirmed) this.options.onPendingChange(false);
      this.settle();
      return;
    }

    const remainingDebounce = Math.max(
      0,
      this.options.debounceMs - (Date.now() - this.lastChangeAt),
    );
    if (this.disposed || this.flushing) {
      void this.persistLatest();
    } else {
      this.schedule(remainingDebounce);
    }
  }

  private settle(): void {
    this.flushing = false;
    this.options.onSettled?.();
    const waiters = this.settleWaiters;
    this.settleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}
