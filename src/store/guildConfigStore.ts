import * as path from 'path';
import { JsonStore } from './jsonStore';

export interface GuildConfig {
  guildId: string;
  publicLobbyChannelId: string;
  privateLobbyChannelId: string;
  /**
   * Text channel holding the "Request to Join" knock panel. Absent on configs
   * written before the knock-panel feature — re-run `/setup` to create it.
   */
  knockChannelId?: string;
  categoryId: string | null;
  adminRoleId: string | null;
  /**
   * Candidate names for new public rooms. On creation one is picked at random;
   * when absent or empty the bot falls back to the generated animal name.
   */
  publicRoomNames?: string[];
  /**
   * Candidate names for new private rooms. On creation one is picked at random;
   * when absent or empty the bot falls back to the generated animal name.
   */
  privateRoomNames?: string[];
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
