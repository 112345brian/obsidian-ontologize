export class IndexTaskQueue {
  private task: Promise<unknown> = Promise.resolve();

  /**
   * Serializes every operation that mutates the live ontology index so a
   * long-running incremental update cannot resolve after a full rebuild and
   * clobber it with a stale graph. Tasks run in submission order regardless of
   * their duration.
   */
  public enqueue<T>(next: () => Promise<T>): Promise<T> {
    const run = this.task.then(next, next);
    this.task = run.then(() => undefined, () => undefined);
    return run;
  }

  public async whenIdle(): Promise<void> {
    await this.task;
  }
}
