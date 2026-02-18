import type { Bot } from "grammy";

import type { BotContext } from "../bot-types.js";

export function registerStartCommand(bot: Bot<BotContext>) {
  bot.command("start", async (ctx) => {
    await ctx.reply(
      [
        ctx.t.start.ready(),
        "",
        ctx.t.start.commandsLabel(),
        "/process_all_shops",
        "/sync_content_shops",
        "/generate_pdfs",
        "/generate_waiting_orders_pdf",
        "/shops",
        "/cancel"
      ].join("\n")
    );
  });
}
