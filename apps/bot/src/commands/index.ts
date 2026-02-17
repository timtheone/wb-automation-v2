import type { Bot } from "grammy";

import type { BackendClient } from "../backend-client.js";
import type { BotContext } from "../bot-types.js";
import { registerCancelCommand } from "./cancel-command.js";
import { registerGeneratePdfsCommand } from "./generate-pdfs-command.js";
import { registerGenerateWaitingOrdersPdfCommand } from "./generate-waiting-orders-pdf-command.js";
import { registerHelpCommand } from "./help-command.js";
import { registerPingCommand } from "./ping-command.js";
import { registerProcessAllShopsCommand } from "./process-all-shops-command.js";
import { registerShopsCommand } from "./shops-command.js";
import { registerStartCommand } from "./start-command.js";
import { registerSyncContentShopsCommand } from "./sync-content-shops-command.js";

export async function registerCommands(bot: Bot<BotContext>, backend: BackendClient) {
  registerStartCommand(bot);
  registerHelpCommand(bot);
  registerPingCommand(bot);
  registerCancelCommand(bot);
  registerProcessAllShopsCommand(bot, backend);
  registerSyncContentShopsCommand(bot, backend);
  registerGeneratePdfsCommand(bot, backend);
  registerGenerateWaitingOrdersPdfCommand(bot, backend);
  registerShopsCommand(bot, backend);

  await bot.api.setMyCommands([
    { command: "process_all_shops", description: "Run process_all_shops flow" },
    { command: "sync_content_shops", description: "Run sync_content_shops flow" },
    { command: "generate_pdfs", description: "Run get_combined_pdf_lists flow" },
    {
      command: "generate_waiting_orders_pdf",
      description: "Run get_waiting_orders_pdf flow"
    },
    { command: "shops", description: "Open shops CRUD menu" },
    { command: "cancel", description: "Cancel current input flow" }
  ]);
}
