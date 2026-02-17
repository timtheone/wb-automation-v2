import type { Bot } from "grammy";

import type { BotContext } from "../bot-types.js";

export function registerPingCommand(bot: Bot<BotContext>) {
  bot.command("ping", async (ctx) => {
    await ctx.reply("pong");
  });
}
