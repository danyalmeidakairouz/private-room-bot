import * as path from 'path';
import { JsonStore } from './jsonStore';

export interface GuildConfig {
  guildId: string;
  lobbyChannelId: string;
  categoryId: string | null;
  adminRoleId: string | null;
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
