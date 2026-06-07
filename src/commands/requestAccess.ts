import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  InteractionContextType,
} from 'discord.js';
import { REQUEST_ACCESS_COMMAND } from '../constants';

// Message context-menu command: right-click a room's card in the knock channel
// → Apps → "Request Access". The handler lives in RoomManager.handleRequestAccess.
export const data = new ContextMenuCommandBuilder()
  .setName(REQUEST_ACCESS_COMMAND)
  .setType(ApplicationCommandType.Message)
  .setContexts(InteractionContextType.Guild);
