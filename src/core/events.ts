import type { SimEvent } from './types';

/** Per-tick event queue. The renderer/systems drain it each frame; tests inspect it. */
export class EventBus {
  private queue: SimEvent[] = [];
  /** Full history is kept only when capture=true (tests). */
  captureAll = false;
  history: SimEvent[] = [];

  emit(e: SimEvent): void {
    this.queue.push(e);
    if (this.captureAll) this.history.push(e);
  }
  drain(): SimEvent[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }
  peek(): readonly SimEvent[] {
    return this.queue;
  }
}
