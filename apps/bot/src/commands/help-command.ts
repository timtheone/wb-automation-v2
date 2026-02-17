import type { Bot } from "grammy";

import type { BotContext } from "../bot-types.js";

export function registerHelpCommand(bot: Bot<BotContext>) {
  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "Use /shops for shop CRUD and token updates.",
        "Use /process_all_shops and /sync_content_shops for operational flows.",
        "PDF commands are wired, backend support is still pending."
      ].join("\n")
    );
  });
}
