import * as path from 'path';
import { JsonStore } from './jsonStore';

/**
 * Persists the set of users the bot has server-muted/deafened for a knock but
 * hasn't lifted yet. A Discord server-mute survives a bot restart, so without
 * this a restart mid-knock would leave a user permanently muted. On startup the
 * ids are reloaded and lifted on the user's next voice join.
 */
export class KnockMuteStore {
  private readonly store: JsonStore<true>;

  constructor(dataDir: string) {
    this.store = new JsonStore<true>(path.join(dataDir, 'knock-muted.json'));
  }

  add(userId: string): void {
    this.store.set(userId, true);
  }

  remove(userId: string): void {
    this.store.delete(userId);
  }

  all(): string[] {
    return Object.keys(this.store.all());
  }
}
