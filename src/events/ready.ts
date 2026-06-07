import { Events, type Client } from 'discord.js';
import { RoomManager } from '../services/roomManager';

export function registerReady(client: Client, roomManager: RoomManager): void {
  client.once(Events.ClientReady, async (c) => {
    console.log(`✅ Logged in as ${c.user.tag}`);
    await roomManager.reconcile();
    roomManager.startSweeper();
  });
}
