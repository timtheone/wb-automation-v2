import type { Bot } from "grammy";

import type { BotContext } from "../bot-types.js";

export function registerCancelCommand(bot: Bot<BotContext>) {
  bot.command("cancel", async (ctx) => {
    if (!ctx.session.pendingAction) {
      await ctx.reply("No active input flow.");
      return;
    }

    ctx.session.pendingAction = null;
    await ctx.reply("Cancelled.");
  });
}
