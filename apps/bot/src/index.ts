import { Bot } from "grammy";

const token = Bun.env.BOT_TOKEN;

if (!token) {
  throw new Error("BOT_TOKEN is not set");
}

const bot = new Bot(token);

bot.command("ping", async (ctx) => {
  await ctx.reply("pong");
});

bot.start();
console.log("bot started");
