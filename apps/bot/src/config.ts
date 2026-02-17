export interface BotConfig {
  token: string;
  backendBaseUrl: string;
  allowedChatIds: Set<number> | null;
}

export function readBotConfig(env: NodeJS.ProcessEnv = Bun.env): BotConfig {
  const token = env.BOT_TOKEN?.trim();

  if (!token) {
    throw new Error("BOT_TOKEN is not set");
  }

  const backendBaseUrl = normalizeBaseUrl(env.BACKEND_BASE_URL?.trim() || "http://localhost:3000");

  return {
    token,
    backendBaseUrl,
    allowedChatIds: parseAllowedChatIds(env.ALLOWED_CHAT_IDS)
  };
}

export function isAllowedChat(allowedChatIds: Set<number> | null, chatId: number | undefined): boolean {
  if (allowedChatIds === null) {
    return true;
  }

  if (chatId === undefined) {
    return false;
  }

  return allowedChatIds.has(chatId);
}

function normalizeBaseUrl(value: string): string {
  if (!value) {
    throw new Error("BACKEND_BASE_URL must not be empty");
  }

  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function parseAllowedChatIds(raw: string | undefined): Set<number> | null {
  if (!raw) {
    return null;
  }

  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) {
    return null;
  }

  const parsed = new Set<number>();

  for (const entry of entries) {
    const chatId = Number(entry);

    if (!Number.isFinite(chatId) || !Number.isInteger(chatId)) {
      throw new Error(`ALLOWED_CHAT_IDS contains invalid value: ${entry}`);
    }

    parsed.add(chatId);
  }

  return parsed;
}
