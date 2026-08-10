import { EventEmitter } from 'events';
import type { PendingMessage, PendingMessageWithId } from '../worker-types.js';
import { logger } from '../../utils/logger.js';

const IDLE_TIMEOUT_MS = 3 * 60 * 1000;

interface BufferedMessage {
  id: number;
  message: PendingMessage;
  claimed: boolean;
  enqueuedAt: number;
}

export interface DrainOptions {
  sessionDbId: number;
  signal: AbortSignal;
  onIdleTimeout?: () => void;
  idleTimeoutMs?: number;
}

export interface DrainBatchOptions {
  sessionDbId: number;
  signal: AbortSignal;
  onIdleTimeout?: () => void;
  idleTimeoutMs?: number;
  /** Max observations to collect before one LLM call; <2 disables batching. */
  batchSize: number;
  /** Milliseconds to wait for more observations before flushing an in-progress batch. */
  timeoutMs: number;
}

export type BatchedMessage =
  | { kind: 'normal'; messages: PendingMessageWithId[]; batchFirstAt: number; batchCount: number }
  | { kind: 'summarize'; message: PendingMessageWithId };

/**
 * Per-session in-RAM observation buffer. This replaces the durable
 * `pending_messages` SQLite queue (and the BullMQ engine that mirrored it).
 *
 * Why in-RAM and not durable: a buffered message is one tool-use fragment fed
 * to a stateful, non-deterministic reducer (the memory agent batches N
 * tool-uses into M observations using in-memory conversation context). The old
 * durable queue persisted the fragments but threw away the reducer state, so
 * "replaying" pending rows after a crash regenerated different/duplicate
 * observations or looped forever — that was the retry storm. The Claude Code
 * transcript JSONL is the real durable source of truth, and transcript replay
 * is the recovery path. So this buffer deliberately holds work only for the
 * worker process lifetime: no 'processing' state to resurrect on restart, no
 * startup sweep, no respawn-on-pending. If the worker dies, the buffer is gone
 * and recovery is a transcript replay.
 *
 * confirm()/resetClaimed() exist only as in-process control flow within a
 * single live generator pass (drop a stored batch; re-yield a batch that
 * couldn't be stored yet because the memory session id wasn't captured). They
 * never cross a process boundary.
 */
export class SessionMessageBuffer {
  private readonly buffers = new Map<number, BufferedMessage[]>();
  private readonly events = new Map<number, EventEmitter>();
  private readonly seenToolUseIds = new Map<number, Set<string>>();
  private nextId = 1;

  constructor(private readonly onMutate?: () => void) {}

  /**
   * Append a message. Returns the assigned id, or 0 if suppressed as a
   * duplicate. Dedup matches the old partial UNIQUE(content_session_id,
   * tool_use_id) index: only observations that carry a toolUseId are deduped,
   * and only against others in the same session for this worker's lifetime.
   */
  enqueue(sessionDbId: number, message: PendingMessage): number {
    const toolUseId = message.toolUseId;
    if (toolUseId) {
      const seen = this.getSeen(sessionDbId);
      if (seen.has(toolUseId)) {
        return 0;
      }
      seen.add(toolUseId);
    }

    const id = this.nextId++;
    this.getList(sessionDbId).push({ id, message, claimed: false, enqueuedAt: Date.now() });
    this.onMutate?.();
    this.signal(sessionDbId);
    return id;
  }

  /** Remove a stored message by id. Returns 1 if found, 0 otherwise. */
  confirm(messageId: number): number {
    for (const list of this.buffers.values()) {
      const idx = list.findIndex(m => m.id === messageId);
      if (idx !== -1) {
        list.splice(idx, 1);
        this.onMutate?.();
        return 1;
      }
    }
    return 0;
  }

  /** Un-claim all messages for a session so the iterator re-yields them. */
  resetClaimed(sessionDbId: number): number {
    const list = this.buffers.get(sessionDbId);
    if (!list) return 0;
    let reset = 0;
    for (const m of list) {
      if (m.claimed) {
        m.claimed = false;
        reset++;
      }
    }
    if (reset > 0) {
      this.onMutate?.();
      this.signal(sessionDbId);
    }
    return reset;
  }

  /** Drop everything buffered for a session. */
  clear(sessionDbId: number): number {
    const cleared = this.buffers.get(sessionDbId)?.length ?? 0;
    this.buffers.delete(sessionDbId);
    // Mirror dispose(): drop the dedup set too. Otherwise a clear() not followed
    // by dispose() leaves seenToolUseIds intact, so a later enqueue carrying a
    // previously-seen toolUseId is silently suppressed (returns 0) and lost.
    this.seenToolUseIds.delete(sessionDbId);
    if (cleared > 0) {
      this.onMutate?.();
    }
    return cleared;
  }

  /** Forget a session entirely (buffer, dedup set, event emitter). */
  dispose(sessionDbId: number): void {
    this.buffers.delete(sessionDbId);
    this.seenToolUseIds.delete(sessionDbId);
    this.events.get(sessionDbId)?.removeAllListeners();
    this.events.delete(sessionDbId);
  }

  getPendingCount(sessionDbId: number): number {
    return this.buffers.get(sessionDbId)?.length ?? 0;
  }

  getTotalDepth(): number {
    let total = 0;
    for (const list of this.buffers.values()) {
      total += list.length;
    }
    return total;
  }

  /**
   * Like drain() but yields one or more observations at a time so a batch-aware
   * consumer can compress N observations into a single LLM call. Key rules:
   *  - summarize messages are NEVER absorbed into a batch: they short-circuit
   *    any in-progress collection and yield as { kind: 'summarize' } immediately,
   *    because the session summary is a once-off, non-dilutable action.
   *  - the batch is flushed when either (a) enough observations accumulate
   *    (>= batchSize) or (b) the batch timeout elapses (whichever comes first).
   *  - the last observed message is always emitted (batch of 1 is valid) — a
   *    lingering in-progress batch must not be silently dropped.
   */
  async *drainBatches(options: DrainBatchOptions): AsyncIterableIterator<BatchedMessage> {
    const { sessionDbId, signal, onIdleTimeout, idleTimeoutMs = IDLE_TIMEOUT_MS, batchSize, timeoutMs } = options;
    let lastActivityTime = Date.now();

    while (!signal.aborted) {
      // Priority: any buffered summarize must be flushed immediately — never
      // let an in-progress observation batch bury the once-per-session summary.
      const pendingSummary = this._peekUnclaimedSummarize(sessionDbId);
      if (pendingSummary) {
        this._unclaim(pendingSummary._persistentId);
        yield { kind: 'summarize', message: pendingSummary };
        lastActivityTime = Date.now();
        continue;
      }

      const claimed = this.claimNext(sessionDbId);
      if (claimed) {
        lastActivityTime = Date.now();
        if (claimed.message.type === 'summarize') {
          yield {
            kind: 'summarize',
            message: {
              ...claimed.message,
              _persistentId: claimed.id,
              _originalTimestamp: claimed.enqueuedAt
            }
          };
          continue;
        }

        // Build an observation batch: keep claiming until full, a summarize
        // appears (unclaim it so the loop-top priority picks it up next), or
        // the buffer runs dry.
        const batchFirstAt = Date.now();
        const batch: PendingMessageWithId[] = [{
          ...claimed.message,
          _persistentId: claimed.id,
          _originalTimestamp: claimed.enqueuedAt
        }];

        while (batch.length < batchSize && !signal.aborted) {
          const next = this.claimNext(sessionDbId);
          if (!next) break;
          if (next.message.type === 'summarize') {
            this._unclaim(next.id);
            break;
          }
          lastActivityTime = Date.now();
          batch.push({
            ...next.message,
            _persistentId: next.id,
            _originalTimestamp: next.enqueuedAt
          });
        }

        // Wait a window for more observations unless the batch is full or a
        // summarize is queued (which we must not delay for).
        if (batch.length < batchSize && !this._peekUnclaimedSummarize(sessionDbId)) {
          await this._waitForBatch(sessionDbId, signal, timeoutMs);
          while (batch.length < batchSize && !signal.aborted) {
            const next = this.claimNext(sessionDbId);
            if (!next) break;
            if (next.message.type === 'summarize') { this._unclaim(next.id); break; }
            batch.push({
              ...next.message,
              _persistentId: next.id,
              _originalTimestamp: next.enqueuedAt
            });
          }
        }

        yield {
          kind: 'normal',
          messages: batch,
          batchFirstAt,
          batchCount: batch.length
        };
        continue;
      }

      // Nothing buffered — wait for new work, honoring the global idle timeout.
      const received = await this.waitForMessage(sessionDbId, signal, idleTimeoutMs);
      if (!received && !signal.aborted) {
        const idleDuration = Date.now() - lastActivityTime;
        if (idleDuration >= idleTimeoutMs) {
          logger.info('SESSION', 'Idle timeout reached in batch drain, triggering abort', {
            sessionDbId,
            idleDurationMs: idleDuration,
            thresholdMs: idleTimeoutMs
          });
          onIdleTimeout?.();
          return;
        }
      } else {
        lastActivityTime = Date.now();
      }
    }
  }

  /** Peek the first un-claimed summarize as a full PendingMessageWithId, if any. */
  private _peekUnclaimedSummarize(sessionDbId: number): PendingMessageWithId | null {
    const list = this.buffers.get(sessionDbId);
    if (!list) return null;
    for (const m of list) {
      if (!m.claimed) {
        if (m.message.type === 'summarize') {
          return { ...m.message, _persistentId: m.id, _originalTimestamp: m.enqueuedAt };
        }
        if (m.message.type === 'observation') break;
      }
    }
    return null;
  }

  private _unclaim(messageId: number): void {
    for (const list of this.buffers.values()) {
      for (const m of list) {
        if (m.id === messageId) { m.claimed = false; return; }
      }
    }
  }

  private _waitForBatch(sessionDbId: number, signal: AbortSignal, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const events = this.getEvents(sessionDbId);
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        events.off('message', onMessage);
        signal.removeEventListener('abort', onAbort);
      };
      const onMessage = () => { cleanup(); resolve(true); };
      const onAbort = () => { cleanup(); resolve(false); };
      const onTimeout = () => { cleanup(); resolve(false); };
      events.once('message', onMessage);
      signal.addEventListener('abort', onAbort, { once: true });
      timeoutId = setTimeout(onTimeout, timeoutMs);
    });
  }

  getMessagesByIds(sessionDbId: number, messageIds: number[]): PendingMessageWithId[] {
    if (messageIds.length === 0) {
      return [];
    }

    const lookup = new Map<number, PendingMessageWithId>();
    for (const buffered of this.buffers.get(sessionDbId) ?? []) {
      lookup.set(buffered.id, {
        ...buffered.message,
        _persistentId: buffered.id,
        _originalTimestamp: buffered.enqueuedAt,
      });
    }

    const messages: PendingMessageWithId[] = [];
    for (const messageId of messageIds) {
      const message = lookup.get(messageId);
      if (message) {
        messages.push(message);
      }
    }
    return messages;
  }

  peekTypes(sessionDbId: number): Array<{ message_type: string; tool_name: string | null }> {
    return (this.buffers.get(sessionDbId) ?? []).map(m => ({
      message_type: m.message.type,
      tool_name: m.message.tool_name ?? null
    }));
  }

  /**
   * Drain buffered messages as they arrive. Yields one unclaimed message at a
   * time; when the buffer is empty it waits on the per-session event emitter
   * until a new message is enqueued, the abort signal fires, or the idle
   * timeout elapses (which triggers onIdleTimeout and ends the iterator so the
   * SDK subprocess is killed).
   */
  async *drain(options: DrainOptions): AsyncIterableIterator<PendingMessageWithId> {
    const { sessionDbId, signal, onIdleTimeout, idleTimeoutMs = IDLE_TIMEOUT_MS } = options;
    let lastActivityTime = Date.now();

    while (!signal.aborted) {
      const claimed = this.claimNext(sessionDbId);
      if (claimed) {
        lastActivityTime = Date.now();
        yield {
          ...claimed.message,
          _persistentId: claimed.id,
          _originalTimestamp: claimed.enqueuedAt
        };
        continue;
      }

      const received = await this.waitForMessage(sessionDbId, signal, idleTimeoutMs);
      if (!received && !signal.aborted) {
        const idleDuration = Date.now() - lastActivityTime;
        if (idleDuration >= idleTimeoutMs) {
          logger.info('SESSION', 'Idle timeout reached, triggering abort to kill subprocess', {
            sessionDbId,
            idleDurationMs: idleDuration,
            thresholdMs: idleTimeoutMs
          });
          onIdleTimeout?.();
          return;
        }
      } else {
        lastActivityTime = Date.now();
      }
    }
  }

  private claimNext(sessionDbId: number): BufferedMessage | null {
    const list = this.buffers.get(sessionDbId);
    if (!list) return null;
    const next = list.find(m => !m.claimed);
    if (!next) return null;
    next.claimed = true;
    this.onMutate?.();
    return next;
  }

  private waitForMessage(sessionDbId: number, signal: AbortSignal, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const events = this.getEvents(sessionDbId);
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        events.off('message', onMessage);
        signal.removeEventListener('abort', onAbort);
      };

      const onMessage = () => {
        cleanup();
        resolve(true);
      };
      const onAbort = () => {
        cleanup();
        resolve(false);
      };
      const onTimeout = () => {
        cleanup();
        resolve(false);
      };

      events.once('message', onMessage);
      signal.addEventListener('abort', onAbort, { once: true });
      timeoutId = setTimeout(onTimeout, timeoutMs);
    });
  }

  private getList(sessionDbId: number): BufferedMessage[] {
    let list = this.buffers.get(sessionDbId);
    if (!list) {
      list = [];
      this.buffers.set(sessionDbId, list);
    }
    return list;
  }

  private getSeen(sessionDbId: number): Set<string> {
    let seen = this.seenToolUseIds.get(sessionDbId);
    if (!seen) {
      seen = new Set<string>();
      this.seenToolUseIds.set(sessionDbId, seen);
    }
    return seen;
  }

  private getEvents(sessionDbId: number): EventEmitter {
    let events = this.events.get(sessionDbId);
    if (!events) {
      events = new EventEmitter();
      this.events.set(sessionDbId, events);
    }
    return events;
  }

  private signal(sessionDbId: number): void {
    this.events.get(sessionDbId)?.emit('message');
  }
}
