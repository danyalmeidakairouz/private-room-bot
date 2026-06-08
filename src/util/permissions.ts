import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';

// Shown when a member who does not outrank the bot tries to run an admin command.
export const OUTRANK_DENIED_MESSAGE =
  "You need a role positioned **above the bot's role** (or the Administrator " +
  'permission) to use this command. Ask a server admin to drag your role above ' +
  'the bot in **Server Settings → Roles**.';

/**
 * Whether the invoking member may run an admin-level bot command.
 *
 * Discord's `default_member_permissions` can only gate slash commands by
 * permission flags, never by role position, so the "must outrank the bot" rule
 * is enforced here at runtime instead. The server owner and anyone with the
 * Administrator permission always pass; otherwise the member's highest role must
 * sit strictly above the bot's highest role.
 *
 * @param interaction The command interaction to check.
 * @return True when the member is allowed to run the command.
 */
export async function memberOutranksBot(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  const guild = interaction.guild;
  if (!guild) {
    return false;
  }
  if (interaction.user.id === guild.ownerId) {
    return true;
  }

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    return false;
  }
  if (member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me) {
    return false;
  }
  return member.roles.highest.position > me.roles.highest.position;
}
