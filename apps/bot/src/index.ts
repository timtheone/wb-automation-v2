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
import { getBotLogFilePath, logger } from "./logger.js";

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
  const commandName = resolveCommandName(ctx.message?.text);
  const updateId = ctx.update.update_id;
  const startedAtMs = Date.now();

  if (commandName) {
    logger.info(
      {
        updateId,
        command: commandName,
        chatId: ctx.chat?.id,
        chatType: ctx.chat?.type,
        userId: ctx.from?.id
      },
      "bot command received"
    );
  }

  const locale = resolveLocale(ctx.from?.language_code);
  ctx.locale = locale;
  ctx.t = createTranslator(locale);
  await next();

  if (commandName) {
    logger.info(
      {
        updateId,
        command: commandName,
        durationMs: Date.now() - startedAtMs
      },
      "bot command completed"
    );
  }
});

bot.catch((error) => {
  const context = error.ctx;

  if (error.error instanceof GrammyError) {
    logger.error(
      {
        updateId: context.update.update_id,
        description: error.error.description
      },
      "telegram api error"
    );
    return;
  }

  if (error.error instanceof HttpError) {
    logger.error(
      {
        updateId: context.update.update_id,
        message: error.error.message
      },
      "telegram network error"
    );
    return;
  }

  logger.error(
    {
      updateId: context.update.update_id,
      error: toErrorMessage(error.error)
    },
    "unhandled bot error"
  );
});

void bootstrap();

async function bootstrap() {
  logger.info(
    {
      backendBaseUrl: config.backendBaseUrl,
      logFilePath: getBotLogFilePath()
    },
    "bot configured"
  );

  try {
    await registerCommands(bot, backend);
    bot.start();
    logger.info({ backendBaseUrl: config.backendBaseUrl }, "bot started");
  } catch (error) {
    logger.fatal({ error: toErrorMessage(error) }, "bot failed to start");
    throw error;
  }
}

function resolveCommandName(text: string | undefined): string | null {
  if (!text || !text.startsWith("/")) {
    return null;
  }

  const firstToken = text.split(/\s+/, 1)[0];

  return firstToken ?? null;
}
