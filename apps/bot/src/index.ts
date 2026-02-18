import {
  Bot,
  GrammyError,
  HttpError,
  session
} from "grammy";

import { createBackendClient } from "./backend-client.js";
import type { BotSession, BotContext } from "./bot-types.js";
import { registerCommands } from "./commands/index.js";
import { toErrorMessage } from "./commands/shared.js";
import { readBotConfig } from "./config.js";
import { createTranslator, resolveLocale } from "./i18n/index.js";

const config = readBotConfig();
const backend = createBackendClient({ baseUrl: config.backendBaseUrl });
const bot = new Bot<BotContext>(config.token);

bot.use(
  session({
    initial: (): BotSession => ({
      pendingAction: null
    }),
    getSessionKey: (ctx) => {
      const chatId = ctx.chat?.id;
      const userId = ctx.from?.id;

      if (chatId === undefined || userId === undefined) {
        return undefined;
      }

      return `${chatId}:${userId}`;
    }
  })
);

bot.use(async (ctx, next) => {
  const locale = resolveLocale(ctx.from?.language_code);
  ctx.locale = locale;
  ctx.t = createTranslator(locale);
  await next();
});

bot.catch((error) => {
  const context = error.ctx;

  if (error.error instanceof GrammyError) {
    console.error("Telegram API error", {
      description: error.error.description,
      updateId: context.update.update_id
    });
    return;
  }

  if (error.error instanceof HttpError) {
    console.error("Telegram network error", {
      updateId: context.update.update_id,
      message: error.error.message
    });
    return;
  }

  console.error("Unhandled bot error", {
    updateId: context.update.update_id,
    error: toErrorMessage(error.error)
  });
});

void bootstrap();

async function bootstrap() {
  await registerCommands(bot, backend);
  bot.start();
  console.log(`bot started (backend: ${config.backendBaseUrl})`);
}
