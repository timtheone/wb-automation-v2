import { typesafeI18nObject } from "typesafe-i18n";

export type BotLocale = "en" | "ru";

const en = {
  commandDescriptions: {
    processAllShops: "Run process_all_shops flow",
    syncContentShops: "Run sync_content_shops flow",
    generatePdfs: "Run get_combined_pdf_lists flow",
    generateWaitingOrdersPdf: "Run get_waiting_orders_pdf flow",
    shops: "Open shops CRUD menu",
    cancel: "Cancel current input flow"
  },
  start: {
    ready: "wb-automation bot is ready.",
    commandsLabel: "Commands:"
  },
  help: {
    line1: "Use /shops for shop CRUD and token updates.",
    line2: "Use /process_all_shops and /sync_content_shops for operational flows.",
    line3: "PDF commands are wired, backend support is still pending."
  },
  ping: {
    pong: "pong"
  },
  cancel: {
    noActiveInputFlow: "No active input flow.",
    cancelled: "Cancelled."
  },
  flows: {
    status: {
      success: "SUCCESS",
      skipped: "SKIPPED",
      failed: "FAILED"
    },
    processAll: {
      running: "Running process_all_shops...",
      completed: "process_all_shops completed",
      processed: "Processed: {count:number}",
      success: "Success: {count:number}",
      skipped: "Skipped: {count:number}",
      failed: "Failed: {count:number}",
      started: "Started: {value}",
      finished: "Finished: {value}",
      details: "Details:",
      ordersInNewLabel: "in_new",
      ordersAttachedLabel: "attached",
      errorSuffix: " | error={error}",
      more: "... and {count:number} more shops"
    },
    syncContent: {
      running: "Running sync_content_shops...",
      completed: "sync_content_shops completed",
      processed: "Processed: {count:number}",
      success: "Success: {count:number}",
      failed: "Failed: {count:number}",
      totalCardsUpserted: "Total cards upserted: {count:number}",
      started: "Started: {value}",
      finished: "Finished: {value}",
      details: "Details:",
      pagesFetchedLabel: "pages",
      cardsUpsertedLabel: "upserted",
      errorSuffix: " | error={error}",
      more: "... and {count:number} more shops"
    },
    generatePdfs: {
      requesting: "Requesting get_combined_pdf_lists...",
      finished: "get_combined_pdf_lists finished."
    },
    generateWaitingOrdersPdf: {
      requesting: "Requesting get_waiting_orders_pdf...",
      finished: "get_waiting_orders_pdf finished."
    }
  },
  shops: {
    menuTitle: "Shops menu",
    createFlowStarted: "Create shop flow started.",
    sendShopName: "Send shop name.",
    useCancelToAbort: "Use /cancel to abort.",
    sendNewShopName: "Send new shop name.",
    sendNewSupplyPrefix: "Send new supply prefix.",
    sendNewProductionToken: "Send new production WB token.",
    sendNewSandboxToken: "Send new sandbox WB token.",
    shopNowStatus: "Shop {name} is now {status}.",
    shopModeNow: "Shop {name} mode is now {mode}.",
    shopDeactivated: "Shop {name} was deactivated.",
    shopRenamed: "Shop renamed to {name}.",
    supplyPrefixUpdated: "Supply prefix updated for {name}.",
    productionTokenUpdated: "Production token updated for {name}.",
    sandboxTokenUpdated: "Sandbox token updated for {name}.",
    noShopsConfiguredYet: "No shops configured yet.",
    sendProductionToken: "Send production WB token.",
    sendSupplyPrefixOrDefault: "Send supply prefix, or '-' to use default.",
    useSandboxQuestion: "Use sandbox mode? Reply yes or no.",
    replyYesOrNo: "Please reply with yes or no.",
    sendSandboxToken: "Send sandbox WB token.",
    shouldBeActiveQuestion: "Should this shop be active now? Reply yes or no.",
    createFlowLostRequiredFields: "Create flow lost required fields. Please run /shops and start again.",
    shopCreated: "Shop created: {name}",
    listHeader: "Shops:",
    listItem: "{index:number}. {name} | {status} | {mode}",
    details: {
      shop: "Shop",
      id: "ID",
      status: "Status",
      mode: "Mode",
      supplyPrefix: "Supply prefix",
      productionToken: "Prod token",
      sandboxToken: "Sandbox token",
      tokenUpdated: "Token updated"
    },
    state: {
      active: "active",
      inactive: "inactive",
      sandbox: "sandbox",
      production: "production",
      notSet: "not set"
    },
    buttons: {
      listShops: "List shops",
      createShop: "Create shop",
      menu: "Menu",
      rename: "Rename",
      updatePrefix: "Update prefix",
      productionToken: "Prod token",
      sandboxToken: "Sandbox token",
      activate: "Activate",
      toggleSandbox: "Toggle sandbox",
      deactivate: "Deactivate",
      backToList: "Back to list"
    }
  },
  errors: {
    requestFailed: "Request failed ({status:number}): {message}",
    unexpected: "Error: {message}",
    createFlowStillActive: "Create flow is still active. Use /cancel if needed.",
    backendEmptyResponse: "Backend returned empty response for {endpoint}",
    telegramChatContextMissing: "Telegram chat context is missing",
    telegramUserContextMissing: "Telegram user context is missing",
    unsupportedChatType: "Unsupported chat type for tenant scoping: {chatType}",
    unableToResolveChatOwner: "Unable to resolve chat owner for tenant scoping",
    shopNotFound: "Shop not found: {shopId}",
    shopNotFoundGeneric: "Shop not found",
    invalidCallbackPayload: "Invalid callback payload",
    fieldMustNotBeEmpty: "{field} must not be empty",
    flowGetCombinedPdfListsNotImplemented: "Flow get_combined_pdf_lists is not implemented yet",
    flowGetWaitingOrdersPdfNotImplemented: "Flow get_waiting_orders_pdf is not implemented yet",
    requestBodyInvalidJson: "Request body must be valid JSON",
    invalidRequestBody: "Invalid request body",
    invalidTelegramContextHeaders: "Invalid Telegram context headers",
    privateOwnerMismatch: "Owner telegram user must match requester in private chats",
    shopNameAlreadyExists: "Shop with this name already exists",
    internalServerError: "Internal server error"
  }
} as const;

type TranslationDictionary = typeof en;

type DeepPartial<TValue> = {
  [K in keyof TValue]?: TValue[K] extends string ? string : DeepPartial<TValue[K]>;
};

const ruOverrides: DeepPartial<TranslationDictionary> = {
  commandDescriptions: {
    processAllShops: "Запустить процесс process_all_shops",
    syncContentShops: "Запустить процесс sync_content_shops",
    generatePdfs: "Запустить процесс get_combined_pdf_lists",
    generateWaitingOrdersPdf: "Запустить процесс get_waiting_orders_pdf",
    shops: "Открыть меню магазинов",
    cancel: "Отменить текущий ввод"
  },
  start: {
    ready: "Бот wb-automation готов к работе.",
    commandsLabel: "Команды:"
  },
  help: {
    line1: "Используйте /shops для CRUD операций с магазинами и обновления токенов.",
    line2: "Используйте /process_all_shops и /sync_content_shops для рабочих процессов.",
    line3: "PDF-команды подключены, но поддержка в backend пока не реализована."
  },
  cancel: {
    noActiveInputFlow: "Сейчас нет активного ввода.",
    cancelled: "Отменено."
  },
  flows: {
    status: {
      success: "УСПЕХ",
      skipped: "ПРОПУЩЕНО",
      failed: "ОШИБКА"
    },
    processAll: {
      running: "Запускаю process_all_shops...",
      completed: "process_all_shops завершен",
      processed: "Обработано: {count:number}",
      success: "Успешно: {count:number}",
      skipped: "Пропущено: {count:number}",
      failed: "С ошибкой: {count:number}",
      started: "Начато: {value}",
      finished: "Завершено: {value}",
      details: "Детали:",
      ordersInNewLabel: "в новых",
      ordersAttachedLabel: "прикреплено",
      errorSuffix: " | ошибка={error}",
      more: "... и еще {count:number} магазинов"
    },
    syncContent: {
      running: "Запускаю sync_content_shops...",
      completed: "sync_content_shops завершен",
      processed: "Обработано: {count:number}",
      success: "Успешно: {count:number}",
      failed: "С ошибкой: {count:number}",
      totalCardsUpserted: "Всего обновлено карточек: {count:number}",
      started: "Начато: {value}",
      finished: "Завершено: {value}",
      details: "Детали:",
      pagesFetchedLabel: "страниц",
      cardsUpsertedLabel: "обновлено",
      errorSuffix: " | ошибка={error}",
      more: "... и еще {count:number} магазинов"
    },
    generatePdfs: {
      requesting: "Запрашиваю get_combined_pdf_lists...",
      finished: "get_combined_pdf_lists завершен."
    },
    generateWaitingOrdersPdf: {
      requesting: "Запрашиваю get_waiting_orders_pdf...",
      finished: "get_waiting_orders_pdf завершен."
    }
  },
  shops: {
    menuTitle: "Меню магазинов",
    createFlowStarted: "Запущено создание магазина.",
    sendShopName: "Отправьте название магазина.",
    useCancelToAbort: "Используйте /cancel для отмены.",
    sendNewShopName: "Отправьте новое название магазина.",
    sendNewSupplyPrefix: "Отправьте новый префикс поставки.",
    sendNewProductionToken: "Отправьте новый production WB токен.",
    sendNewSandboxToken: "Отправьте новый sandbox WB токен.",
    shopNowStatus: "Магазин {name} теперь {status}.",
    shopModeNow: "Режим магазина {name}: {mode}.",
    shopDeactivated: "Магазин {name} деактивирован.",
    shopRenamed: "Магазин переименован в {name}.",
    supplyPrefixUpdated: "Префикс поставки обновлен для {name}.",
    productionTokenUpdated: "Production токен обновлен для {name}.",
    sandboxTokenUpdated: "Sandbox токен обновлен для {name}.",
    noShopsConfiguredYet: "Пока нет настроенных магазинов.",
    sendProductionToken: "Отправьте production WB токен.",
    sendSupplyPrefixOrDefault: "Отправьте префикс поставки или '-' для значения по умолчанию.",
    useSandboxQuestion: "Использовать sandbox режим? Ответьте да или нет.",
    replyYesOrNo: "Пожалуйста, ответьте да или нет.",
    sendSandboxToken: "Отправьте sandbox WB токен.",
    shouldBeActiveQuestion: "Сделать магазин активным сейчас? Ответьте да или нет.",
    createFlowLostRequiredFields: "В процессе создания потерялись обязательные поля. Запустите /shops и начните снова.",
    shopCreated: "Магазин создан: {name}",
    listHeader: "Магазины:",
    listItem: "{index:number}. {name} | {status} | {mode}",
    details: {
      shop: "Магазин",
      id: "ID",
      status: "Статус",
      mode: "Режим",
      supplyPrefix: "Префикс поставки",
      productionToken: "Prod токен",
      sandboxToken: "Sandbox токен",
      tokenUpdated: "Токен обновлен"
    },
    state: {
      active: "активен",
      inactive: "неактивен",
      sandbox: "sandbox",
      production: "production",
      notSet: "не задан"
    },
    buttons: {
      listShops: "Список магазинов",
      createShop: "Создать магазин",
      menu: "Меню",
      rename: "Переименовать",
      updatePrefix: "Обновить префикс",
      productionToken: "Prod токен",
      sandboxToken: "Sandbox токен",
      activate: "Активировать",
      toggleSandbox: "Перекл. sandbox",
      deactivate: "Деактивировать",
      backToList: "Назад к списку"
    }
  },
  errors: {
    requestFailed: "Ошибка запроса ({status:number}): {message}",
    unexpected: "Ошибка: {message}",
    createFlowStillActive: "Процесс создания все еще активен. Используйте /cancel при необходимости.",
    backendEmptyResponse: "Backend вернул пустой ответ для {endpoint}",
    telegramChatContextMissing: "Отсутствует Telegram chat context",
    telegramUserContextMissing: "Отсутствует Telegram user context",
    unsupportedChatType: "Неподдерживаемый тип чата для tenant scoping: {chatType}",
    unableToResolveChatOwner: "Не удалось определить владельца чата для tenant scoping",
    shopNotFound: "Магазин не найден: {shopId}",
    shopNotFoundGeneric: "Магазин не найден",
    invalidCallbackPayload: "Некорректный callback payload",
    fieldMustNotBeEmpty: "Поле {field} не должно быть пустым",
    flowGetCombinedPdfListsNotImplemented: "Flow get_combined_pdf_lists пока не реализован",
    flowGetWaitingOrdersPdfNotImplemented: "Flow get_waiting_orders_pdf пока не реализован",
    requestBodyInvalidJson: "Тело запроса должно быть валидным JSON",
    invalidRequestBody: "Некорректное тело запроса",
    invalidTelegramContextHeaders: "Некорректные Telegram context headers",
    privateOwnerMismatch: "В private chat владелец должен совпадать с отправителем",
    shopNameAlreadyExists: "Магазин с таким названием уже существует",
    internalServerError: "Внутренняя ошибка сервера"
  }
};

const ru = mergeDictionaries(en, ruOverrides);

const dictionaries: Record<BotLocale, TranslationDictionary> = {
  en,
  ru
};

export function resolveLocale(languageCode: string | undefined): BotLocale {
  const normalized = languageCode?.trim().toLowerCase();

  if (normalized?.startsWith("ru")) {
    return "ru";
  }

  return "en";
}

export function createTranslator(locale: BotLocale) {
  return typesafeI18nObject(locale, dictionaries[locale]);
}

export type BotTranslator = ReturnType<typeof createTranslator>;

function mergeDictionaries<T extends Record<string, unknown>>(
  base: T,
  overrides: DeepPartial<T>
): T {
  const result: Record<string, unknown> = { ...base };

  for (const [key, overrideValue] of Object.entries(overrides)) {
    if (overrideValue === undefined) {
      continue;
    }

    const baseValue = result[key];

    if (isObject(baseValue) && isObject(overrideValue)) {
      result[key] = mergeDictionaries(
        baseValue,
        overrideValue as DeepPartial<Record<string, unknown>>
      );
      continue;
    }

    result[key] = overrideValue;
  }

  return result as T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
