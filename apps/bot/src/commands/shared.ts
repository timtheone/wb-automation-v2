import { BackendApiHttpError } from "../backend-client.js";
import type { BotContext } from "../bot-types.js";

export async function replyWithError(ctx: BotContext, error: unknown) {
  const pending = ctx.session.pendingAction;

  if (error instanceof BackendApiHttpError) {
    await ctx.reply(`Request failed (${error.status}): ${error.message}`);
    return;
  }

  await ctx.reply(`Error: ${toErrorMessage(error)}`);

  if (pending && pending.kind === "create") {
    await ctx.reply("Create flow is still active. Use /cancel if needed.");
  }
}

export function requireResponseData<T>(payload: T | undefined, endpoint: string): T {
  if (payload === undefined) {
    throw new Error(`Backend returned empty response for ${endpoint}`);
  }

  return payload;
}

export function formatIsoDate(isoDate: string): string {
  const parsed = new Date(isoDate);

  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }

  return parsed.toISOString();
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
