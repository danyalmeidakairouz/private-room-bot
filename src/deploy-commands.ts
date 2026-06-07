import { REST, Routes } from 'discord.js';
import { loadConfig } from './config';
import * as setup from './commands/setup';
import * as requestAccess from './commands/requestAccess';

(async () => {
  try {
    const config = loadConfig();
    const commands = [setup.data.toJSON(), requestAccess.data.toJSON()];
    const rest = new REST({ version: '10' }).setToken(config.token);

    console.log(`[deploy-commands] Registering ${commands.length} slash command(s)…`);

    if (config.guildId) {
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: commands },
      );
      console.log(
        `[deploy-commands] Registered ${commands.length} guild command(s) to ${config.guildId}.`,
      );
    }
    else {
      await rest.put(
        Routes.applicationCommands(config.clientId),
        { body: commands },
      );
      console.log(
        `[deploy-commands] Registered ${commands.length} global command(s) (may take up to 1h to propagate).`,
      );
    }
  }
  catch (err) {
    console.error('[deploy-commands] Failed to register commands:', err);
    process.exit(1);
  }
})();
