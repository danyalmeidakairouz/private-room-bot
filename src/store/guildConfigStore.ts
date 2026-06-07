import * as path from 'path';
import { JsonStore } from './jsonStore';

export interface GuildConfig {
  guildId: string;
  publicLobbyChannelId: string;
  privateLobbyChannelId: string;
  /**
   * Voice channel knockers are held in while they wait for approval. Absent on
   * configs written before the waiting-room feature — re-run `/setup` to create it.
   */
  waitingRoomChannelId?: string;
  /** @deprecated Old request-to-join text channel; no longer created or used. */
  knockChannelId?: string;
  categoryId: string | null;
  adminRoleId: string | null;
  /**
   * @deprecated Legacy single-lobby field from the pre-public-rooms config.
   * Read as the private lobby when {@link privateLobbyChannelId} is absent so
   * already-deployed guilds keep working until `/setup` is re-run.
   */
  lobbyChannelId?: string;
}

export class GuildConfigStore {
  private readonly store: JsonStore<GuildConfig>;

  constructor(dataDir: string) {
    this.store = new JsonStore<GuildConfig>(path.join(dataDir, 'guild-config.json'));
  }

  get(guildId: string): GuildConfig | undefined {
    return this.store.get(guildId);
  }

  set(config: GuildConfig): void {
    this.store.set(config.guildId, config);
  }

  delete(guildId: string): void {
    this.store.delete(guildId);
  }
}
