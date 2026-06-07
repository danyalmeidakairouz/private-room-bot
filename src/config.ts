import 'dotenv/config';

export interface BotConfig {
  token: string;
  clientId: string;
  guildId: string | null;
  dataDir: string;
}

export function loadConfig(): BotConfig {
  const missing: string[] = [];

  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    missing.push('DISCORD_TOKEN');
  }

  const clientId = process.env.CLIENT_ID;
  if (!clientId) {
    missing.push('CLIENT_ID');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const guildIdRaw = process.env.GUILD_ID;
  const guildId = guildIdRaw && guildIdRaw.trim() !== '' ? guildIdRaw : null;

  const dataDir = process.env.DATA_DIR ?? './data';

  return {
    token: token as string,
    clientId: clientId as string,
    guildId,
    dataDir,
  };
}
