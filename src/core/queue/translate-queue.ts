import { ProviderError, type TranslateItem } from '../../providers/types';

export interface QueueItem {
  key: string;
  markup: string;
  priority: number;
  tabId: number;
}
export interface QueueOptions {
  translate: (
    items: TranslateItem[],
    signal: AbortSignal,
  ) => Promise<TranslateItem[]>;
  maxBatchItems?: number;
  maxBatchTokens?: number;
  debounceMs?: number;
  concurrency?: number;
  maxAttempts?: number;
  maxMissingRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}
interface Job {
  item: QueueItem;
  order: number;
  tabs: Set<number>;
  state: 'pending' | 'running' | 'done';
  missing: number;
  promise: Promise<string>;
  resolve: (text: string) => void;
  reject: (error: ProviderError) => void;
}
interface Batch {
  jobs: Job[];
  controller: AbortController;
}
export class TranslateQueue {
  private opts: Required<QueueOptions>;
  private jobs = new Map<string, Job>();
  private pending: Job[] = [];
  private running = new Set<Batch>();
  private order = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(opts: QueueOptions) {
    this.opts = {
      maxBatchItems: 40,
      maxBatchTokens: 2500,
      debounceMs: 50,
      concurrency: 3,
      maxAttempts: 3,
      maxMissingRetries: 2,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      random: Math.random,
      ...opts,
    };
    for (const name of [
      'maxBatchItems',
      'maxBatchTokens',
      'concurrency',
      'maxAttempts',
    ] as const) {
      if (!Number.isInteger(this.opts[name]) || this.opts[name] < 1)
        throw new RangeError(`Invalid ${name}`);
    }
    if (
      !Number.isInteger(this.opts.maxMissingRetries) ||
      this.opts.maxMissingRetries < 0 ||
      !Number.isFinite(this.opts.debounceMs) ||
      this.opts.debounceMs < 0
    )
      throw new RangeError('Invalid retry or debounce limit');
  }
  enqueue(item: QueueItem): Promise<string> {
    const existing = this.jobs.get(item.key);
    if (existing) {
      existing.tabs.add(item.tabId);
      return existing.promise;
    }
    if (!Number.isFinite(item.priority))
      return Promise.reject(new ProviderError('bad_request'));
    let resolve!: Job['resolve'];
    let reject!: Job['reject'];
    const promise = new Promise<string>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const job: Job = {
      item: { ...item },
      order: this.order++,
      tabs: new Set([item.tabId]),
      state: 'pending',
      missing: 0,
      promise,
      resolve,
      reject,
    };
    this.jobs.set(item.key, job);
    this.pending.push(job);
    this.schedule();
    return promise;
  }
  cancelTab(tabId: number): void {
    for (const job of this.jobs.values()) {
      job.tabs.delete(tabId);
      if (!job.tabs.size) this.finish(job, new ProviderError('aborted'));
    }
    for (const batch of this.running) {
      if (batch.jobs.every((job) => job.state === 'done'))
        batch.controller.abort();
    }
  }
  private finish(job: Job, result: string | ProviderError): void {
    if (job.state === 'done') return;
    job.state = 'done';
    if (this.jobs.get(job.item.key) === job) this.jobs.delete(job.item.key);
    if (typeof result === 'string') job.resolve(result);
    else job.reject(result);
  }
  private schedule(): void {
    if (
      this.timer !== undefined ||
      !this.pending.some((job) => job.state === 'pending')
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.pump();
    }, this.opts.debounceMs);
  }
  private pump(): void {
    this.pending = this.pending
      .filter((job) => job.state === 'pending')
      .sort((a, b) => b.item.priority - a.item.priority || a.order - b.order);
    while (this.pending.length && this.running.size < this.opts.concurrency) {
      const jobs: Job[] = [];
      let tokens = 0;
      while (this.pending.length && jobs.length < this.opts.maxBatchItems) {
        const next = this.pending[0]!;
        const size = Math.ceil(next.item.markup.length / 3);
        if (size > this.opts.maxBatchTokens) {
          if (jobs.length > 0) break;
          this.pending.shift();
          next.state = 'running';
          jobs.push(next);
          break;
        }
        if (tokens + size > this.opts.maxBatchTokens) break;
        this.pending.shift();
        next.state = 'running';
        jobs.push(next);
        tokens += size;
      }
      if (!jobs.length) break;
      const batch = { jobs, controller: new AbortController() };
      this.running.add(batch);
      void this.run(batch).finally(() => {
        this.running.delete(batch);
        this.schedule();
      });
    }
  }
  private async abortable<T>(
    work: Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    let abort!: () => void;
    const canceled = new Promise<never>((_, reject) => {
      abort = () => reject(new ProviderError('aborted'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    try {
      return await Promise.race([work, canceled]);
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }
  private async run(batch: Batch): Promise<void> {
    const { signal } = batch.controller;
    const items = batch.jobs.map((job, id) => ({
      id: String(id),
      text: job.item.markup,
    }));
    try {
      let result: TranslateItem[] = [];
      for (let attempt = 1; attempt <= this.opts.maxAttempts; attempt++) {
        try {
          if (signal.aborted) throw new ProviderError('aborted');
          result = await this.abortable(
            this.opts.translate(items, signal),
            signal,
          );
          break;
        } catch (error) {
          const failure =
            error instanceof ProviderError
              ? error
              : new ProviderError('network');
          if (
            signal.aborted ||
            attempt === this.opts.maxAttempts ||
            !['rate_limit', 'server', 'network'].includes(failure.kind)
          )
            throw failure;
          const delay =
            failure.retryAfterMs ??
            1000 * 2 ** (attempt - 1) * (0.8 + this.opts.random() * 0.4);
          await this.abortable(this.opts.sleep(delay), signal);
        }
      }
      if (!Array.isArray(result)) throw new ProviderError('invalid_response');
      const translated = new Map<string, string>();
      for (const item of result) {
        if (
          !item ||
          typeof item.id !== 'string' ||
          typeof item.text !== 'string' ||
          !items.some((expected) => expected.id === item.id) ||
          translated.has(item.id)
        )
          throw new ProviderError('invalid_response');
        translated.set(item.id, item.text);
      }
      batch.jobs.forEach((job, id) => {
        if (job.state === 'done') return;
        const text = translated.get(String(id));
        if (text !== undefined) this.finish(job, text);
        else if (job.missing++ >= this.opts.maxMissingRetries)
          this.finish(
            job,
            new ProviderError(
              'invalid_response',
              'Translation repeatedly omitted an item',
            ),
          );
        else {
          job.state = 'pending';
          this.pending.push(job);
        }
      });
    } catch (error) {
      const failure = signal.aborted
        ? new ProviderError('aborted')
        : error instanceof ProviderError
          ? error
          : new ProviderError('network');
      for (const job of batch.jobs) this.finish(job, failure);
    }
  }
}
