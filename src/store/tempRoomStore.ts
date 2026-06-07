import * as path from 'path';
import { JsonStore } from './jsonStore';

export interface TempRoom {
  channelId: string;
  roleId: string;
  ownerId: string;
  guildId: string;
  createdAt: number;
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
