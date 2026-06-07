import * as path from 'path';
import { JsonStore } from './jsonStore';

export type RoomType = 'public' | 'private';

export interface TempRoom {
  channelId: string;
  /** Gating role id for private rooms; `null` for public rooms (no role is created). */
  roleId: string | null;
  ownerId: string;
  guildId: string;
  createdAt: number;
  /** Defaults to `'private'` when absent so legacy records keep their behavior. */
  type: RoomType;
}

export class TempRoomStore {
  private readonly store: JsonStore<TempRoom>;

  constructor(dataDir: string) {
    this.store = new JsonStore<TempRoom>(path.join(dataDir, 'temp-rooms.json'));
  }

  add(room: TempRoom): void {
    this.store.set(room.channelId, room);
  }

  get(channelId: string): TempRoom | undefined {
    return this.store.get(channelId);
  }

  remove(channelId: string): void {
    this.store.delete(channelId);
  }

  all(): TempRoom[] {
    return Object.values(this.store.all());
  }

  byGuild(guildId: string): TempRoom[] {
    return this.all().filter((r) => r.guildId === guildId);
  }
}
