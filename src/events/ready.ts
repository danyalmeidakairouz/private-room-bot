import { Events, type Client } from 'discord.js';
import { generateDependencyReport } from '@discordjs/voice';
import { RoomManager } from '../services/roomManager';

export function registerReady(client: Client, roomManager: RoomManager): void {
  client.once(Events.ClientReady, async (c) => {
    console.log(`✅ Logged in as ${c.user.tag}`);
    // Log the voice dependency report once so the host logs confirm which opus /
    // encryption / DAVE libraries loaded — DAVE (@snazzah/davey) is required for
    // voice connections now that Discord enforces E2EE (close code 4017 without it).
    console.log('[voice] dependency report:\n' + generateDependencyReport());
    await roomManager.reconcile();
    roomManager.startSweeper();
  });
}
