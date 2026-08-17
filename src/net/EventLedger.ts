import type { MatchEventEnvelope, ViewerMatchEvent } from './protocol';

export class EventLedger {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];

  accept(envelope: MatchEventEnvelope): ViewerMatchEvent[] {
    const accepted: ViewerMatchEvent[] = [];
    for (const event of envelope.events) {
      const key = `${envelope.matchId}:${event.id}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.order.push(key);
      accepted.push(event);
    }
    while (this.order.length > 512) {
      const oldest = this.order.shift();
      if (oldest) this.seen.delete(oldest);
    }
    return accepted;
  }

  clear(): void {
    this.seen.clear();
    this.order.length = 0;
  }
}
