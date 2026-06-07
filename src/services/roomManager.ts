import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildMember,
} from 'discord.js';
import { GuildConfigStore } from '../store/guildConfigStore';
import { TempRoomStore, type TempRoom } from '../store/tempRoomStore';
import { generateRoomName } from '../util/nameGenerator';
import { DEFAULTS } from '../constants';

export class RoomManager {
  private readonly client: Client;
  private readonly guildConfig: GuildConfigStore;
  private readonly tempRooms: TempRoomStore;
  private readonly creating = new Set<string>();
  private readonly pendingCleanup = new Set<string>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(client: Client, guildConfig: GuildConfigStore, tempRooms: TempRoomStore) {
    this.client = client;
    this.guildConfig = guildConfig;
    this.tempRooms = tempRooms;
  }

  static computeRolePosition(botHighestPosition: number, adminPosition: number | null): number {
    const target =
      (adminPosition !== null ? Math.min(adminPosition, botHighestPosition) : botHighestPosition) -
      1;
    return Math.max(target, 1);
  }

  async createRoom(member: GuildMember): Promise<void> {
    if (this.creating.has(member.id)) {
      return;
    }
    this.creating.add(member.id);
    try {
      const guild = member.guild;
      const cfg = this.guildConfig.get(guild.id);
      if (!cfg) {
        return;
      }

      // F3: enforce per-owner and per-guild room caps before doing any API calls.
      const existing = this.tempRooms.byGuild(guild.id);
      if (existing.some((r) => r.ownerId === member.id)) {
        return; // member already owns an active room
      }
      if (existing.length >= DEFAULTS.maxRoomsPerGuild) {
        console.warn(
          `[RoomManager] Guild ${guild.id} hit the temp-room cap (${DEFAULTS.maxRoomsPerGuild}).`,
        );
        return;
      }

      const name = generateRoomName();

      // Compute a safe role position below the bot's highest role and optionally below the admin role.
      const me = await guild.members.fetchMe();
      const botHighest = me.roles.highest.position;
      const adminPos =
        cfg.adminRoleId ? (guild.roles.cache.get(cfg.adminRoleId)?.position ?? null) : null;
      const position = RoomManager.computeRolePosition(botHighest, adminPos);

      // Create the private room role.
      const role = await guild.roles.create({
        name,
        mentionable: false,
        hoist: false,
        reason: `Temp room for ${member.user.tag}`,
      });
      await role.setPosition(position).catch(() => {
        console.warn(
          `[RoomManager] Could not set role position for ${role.id} — hierarchy too tight.`,
        );
      });

      // Create the voice channel with appropriate permission overwrites.
      const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        parent: cfg.categoryId ?? undefined,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
          },
          {
            id: role.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
            ],
          },
          {
            id: member.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
              PermissionFlagsBits.MoveMembers,
            ],
          },
        ],
        reason: 'Temporary private voice room',
      });

      // Persist the record before the move so cleanup can act on it even if the move fails.
      const roomRecord: TempRoom = {
        channelId: channel.id,
        roleId: role.id,
        ownerId: member.id,
        guildId: guild.id,
        createdAt: Date.now(),
      };
      this.tempRooms.add(roomRecord);

      // F4: log a warning if role assignment fails (e.g. missing Manage Roles permission).
      await member.roles
        .add(role)
        .catch(() =>
          console.warn(`[RoomManager] Could not assign role ${role.id} to ${member.id}.`),
        );

      // Move owner into the channel; on failure roll back the created resources.
      try {
        await member.voice.setChannel(channel); // F9: no cast needed — create() returns VoiceChannel
      } catch {
        await this.destroyRoom(channel.id, guild);
        return;
      }

      // Create an invite link for easy sharing.
      const invite = await channel
        .createInvite({ maxAge: DEFAULTS.inviteMaxAgeSec, maxUses: 0 })
        .catch(() => null);

      const message =
        `🔊 Your private room **${name}** is ready! Invite friends: ${invite?.url ?? '(invite unavailable)'} — or just drag them into the channel.`;

      await channel.send(message).catch(() => {}); // F9: channel is already VoiceChannel; .send() is available
      await member.send(message).catch(() => {});
    } catch (err) {
      console.error('[RoomManager] Unexpected error in createRoom:', err);
    } finally {
      this.creating.delete(member.id);
    }
  }

  scheduleCleanup(channelId: string, guild: Guild): void {
    // Safety: only act on channels we own — prevents accidental deletion of non-temp channels.
    if (!this.tempRooms.get(channelId)) {
      return;
    }
    if (this.pendingCleanup.has(channelId)) {
      return;
    }
    this.pendingCleanup.add(channelId);
    setTimeout(async () => {
      try {
        const ch = await guild.channels.fetch(channelId).catch(() => null);
        if (ch && ch.isVoiceBased() && ch.members.size === 0) {
          await this.destroyRoom(channelId, guild);
        }
      } finally {
        this.pendingCleanup.delete(channelId);
      }
    }, DEFAULTS.graceMs);
  }

  async destroyRoom(channelId: string, guild: Guild): Promise<void> {
    const room = this.tempRooms.get(channelId);
    await guild.channels.delete(channelId, 'Temp room empty').catch(() => {});
    if (room?.roleId) {
      await guild.roles.delete(room.roleId, 'Temp room closed').catch(() => {});
    }
    this.tempRooms.remove(channelId);
  }

  // F1: single source of truth for the per-room sweep logic.
  private async sweepOnce(): Promise<void> {
    for (const room of this.tempRooms.all()) {
      // F2: try cache first; fall back to a fetch so we can purge records for guilds the bot left.
      let guild = this.client.guilds.cache.get(room.guildId) ?? null;
      if (!guild) {
        guild = await this.client.guilds.fetch(room.guildId).catch(() => null);
      }
      if (!guild) {
        // Bot is no longer in this guild — purge the stale record to prevent disk leaks.
        this.tempRooms.remove(room.channelId);
        continue;
      }

      const ch = await guild.channels.fetch(room.channelId).catch(() => null);
      if (!ch) {
        // Channel is gone — clean up orphaned role and remove the record.
        if (room.roleId) {
          await guild.roles.delete(room.roleId, 'Temp room closed').catch(() => {});
        }
        this.tempRooms.remove(room.channelId);
      } else if (ch.isVoiceBased() && ch.members.size === 0) {
        await this.destroyRoom(room.channelId, guild);
      }
      // Channel exists and has members — leave it; events will handle teardown.
    }
  }

  // F1: guarded interval start — called once from ready.ts after reconcile().
  startSweeper(): void {
    if (this.sweeper) {
      return;
    }
    this.sweeper = setInterval(() => {
      void this.sweepOnce();
    }, DEFAULTS.sweepIntervalMs);
  }

  // F1: reconcile on startup, then let startSweeper() handle periodic runs.
  async reconcile(): Promise<void> {
    await this.sweepOnce();
  }
}
