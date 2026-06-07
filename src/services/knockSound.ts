import * as path from 'path';
import { createReadStream } from 'fs';
import sodium from 'libsodium-wrappers';
import { type VoiceBasedChannel } from 'discord.js';
import {
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice';

// Pre-encoded OggOpus (48 kHz stereo) so playback needs no ffmpeg/opus encoder
// at runtime — @discordjs/voice streams the Opus packets straight through.
// __dirname is dist/services at runtime, so the asset sits two levels up.
const KNOCK_FILE = path.join(__dirname, '..', '..', 'assets', 'knock.ogg');

// Discord allows only ONE voice connection per guild for the bot. Track which
// guilds are mid-knock so a second overlapping request doesn't hijack and then
// destroy the connection the first one is still using.
const playingGuilds = new Set<string>();

/**
 * Join a voice channel, play the knock sound once, then leave. Best-effort —
 * any failure (permissions, encryption lib, codec) is logged and swallowed so
 * a missing sound never breaks the request-access flow.
 */
export async function playKnock(channel: VoiceBasedChannel): Promise<void> {
  const guildId = channel.guild.id;
  if (playingGuilds.has(guildId)) {
    return; // a knock is already playing in this guild — don't disturb it
  }
  playingGuilds.add(guildId);

  let connection: ReturnType<typeof joinVoiceChannel> | undefined;
  try {
    // libsodium initializes asynchronously; ensure it's ready before voice
    // encryption needs it, otherwise the first connection can fail.
    await sodium.ready;

    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

    const player = createAudioPlayer();
    const resource = createAudioResource(createReadStream(KNOCK_FILE), {
      inputType: StreamType.OggOpus,
    });
    connection.subscribe(player);
    player.play(resource);

    // Wait until playback finishes (or the timeout) before leaving. A short clip
    // can reach Idle quickly, so we don't bother waiting for Playing first.
    await entersState(player, AudioPlayerStatus.Idle, 15_000);
  }
  catch (err) {
    console.warn('[knockSound] Could not play knock sound:', err);
  }
  finally {
    connection?.destroy();
    playingGuilds.delete(guildId);
  }
}
