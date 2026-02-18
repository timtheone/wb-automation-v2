export interface BotConfig {
  token: string;
  backendBaseUrl: string;
}

export function readBotConfig(env: NodeJS.ProcessEnv = Bun.env): BotConfig {
  const token = env.BOT_TOKEN?.trim();

  if (!token) {
    throw new Error("BOT_TOKEN is not set");
  }

  const backendBaseUrl = normalizeBaseUrl(env.BACKEND_BASE_URL?.trim() || "http://localhost:3000");

  return {
    token,
    backendBaseUrl
  };
}

function normalizeBaseUrl(value: string): string {
  if (!value) {
    throw new Error("BACKEND_BASE_URL must not be empty");
  }

  return value.endsWith("/") ? value.slice(0, -1) : value;
}
