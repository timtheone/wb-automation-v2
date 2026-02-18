import type { Bot } from "grammy";

import type { BotContext } from "../bot-types.js";

export function registerHelpCommand(bot: Bot<BotContext>) {
  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        ctx.t.help.line1(),
        ctx.t.help.line2(),
        ctx.t.help.line3()
      ].join("\n")
    );
  });
}
