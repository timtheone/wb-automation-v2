import type { Bot } from "grammy";

import type { BackendClient } from "../backend-client.js";
import type { BotContext } from "../bot-types.js";
import { createTranslator, type BotTranslator } from "../i18n/index.js";
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

  const en = createTranslator("en");
  const ru = createTranslator("ru");

  await bot.api.setMyCommands(toTelegramCommands(en));
  await bot.api.setMyCommands(toTelegramCommands(ru), { language_code: "ru" });
}

function toTelegramCommands(t: BotTranslator) {
  return [
    { command: "process_all_shops", description: t.commandDescriptions.processAllShops() },
    { command: "sync_content_shops", description: t.commandDescriptions.syncContentShops() },
    { command: "generate_pdfs", description: t.commandDescriptions.generatePdfs() },
    {
      command: "generate_waiting_orders_pdf",
      description: t.commandDescriptions.generateWaitingOrdersPdf()
    },
    { command: "shops", description: t.commandDescriptions.shops() },
    { command: "cancel", description: t.commandDescriptions.cancel() }
  ];
}
