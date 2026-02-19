import { createDbRepositories, type Database } from "@wb-automation-v2/db";

const DAY_IN_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_WARNING_THRESHOLD_DAYS = 4;

export interface WbTokenExpirationWarning {
  shopId: string;
  shopName: string;
  tokenType: "production";
  expiresAt: Date;
  daysLeft: number;
}

export interface WbTokenExpirationInvalidToken {
  shopId: string;
  shopName: string;
  tokenType: "production";
  reason: string;
}

export interface CheckWbTokenExpirationResult {
  processedShops: number;
  warnings: WbTokenExpirationWarning[];
  invalidTokens: WbTokenExpirationInvalidToken[];
  expiredTokensCount: number;
}

type CheckWbTokenExpirationOptions = {
  tenantId: string;
  db?: Database;
  now?: () => Date;
  warningThresholdDays?: number;
};

export interface CheckWbTokenExpirationService {
  checkWbTokenExpiration(): Promise<CheckWbTokenExpirationResult>;
}

export function createCheckWbTokenExpirationService(
  options: CheckWbTokenExpirationOptions
): CheckWbTokenExpirationService {
  const now = options.now ?? (() => new Date());
  const warningThresholdDays = options.warningThresholdDays ?? DEFAULT_WARNING_THRESHOLD_DAYS;
  const { shops } = createDbRepositories({
    tenantId: options.tenantId,
    db: options.db
  });

  return {
    async checkWbTokenExpiration() {
      const allShops = await shops.listShops();
      const warnings: WbTokenExpirationWarning[] = [];
      const invalidTokens: WbTokenExpirationInvalidToken[] = [];
      let expiredTokensCount = 0;

      for (const shop of allShops) {
        const decoded = decodeJwtExpiration(shop.wbToken);

        if (!decoded.ok) {
          invalidTokens.push({
            shopId: shop.id,
            shopName: shop.name,
            tokenType: "production",
            reason: decoded.reason
          });
          continue;
        }

        const expiresAtMs = decoded.expiresAt.getTime();
        const nowMs = now().getTime();

        if (expiresAtMs <= nowMs) {
          expiredTokensCount += 1;
          continue;
        }

        const thresholdMs = nowMs + warningThresholdDays * DAY_IN_MS;

        if (expiresAtMs > thresholdMs) {
          continue;
        }

        const daysLeft = Math.max(0, Math.ceil((expiresAtMs - nowMs) / DAY_IN_MS));

        warnings.push({
          shopId: shop.id,
          shopName: shop.name,
          tokenType: "production",
          expiresAt: decoded.expiresAt,
          daysLeft
        });
      }

      warnings.sort((left, right) => {
        const byDays = left.daysLeft - right.daysLeft;

        if (byDays !== 0) {
          return byDays;
        }

        return left.shopName.localeCompare(right.shopName, "ru");
      });

      return {
        processedShops: allShops.length,
        warnings,
        invalidTokens,
        expiredTokensCount
      };
    }
  };
}

type JwtExpirationDecodeResult =
  | { ok: true; expiresAt: Date }
  | { ok: false; reason: string };

function decodeJwtExpiration(token: string): JwtExpirationDecodeResult {
  const parts = token.split(".");
  const payload = parts[1];

  if (parts.length < 2 || typeof payload !== "string" || payload.length === 0) {
    return { ok: false, reason: "token is not a JWT" };
  }

  try {
    const decoded = Buffer.from(normalizeBase64Url(payload), "base64").toString("utf8");
    const json = JSON.parse(decoded) as { exp?: unknown };

    if (typeof json.exp !== "number" || !Number.isFinite(json.exp)) {
      return { ok: false, reason: "exp claim is missing" };
    }

    const expiresAt = new Date(json.exp * 1_000);

    if (Number.isNaN(expiresAt.getTime())) {
      return { ok: false, reason: "exp claim is invalid" };
    }

    return { ok: true, expiresAt };
  } catch {
    return { ok: false, reason: "token payload is not valid JSON" };
  }
}

function normalizeBase64Url(value: string): string {
  const replaced = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const remainder = replaced.length % 4;

  if (remainder === 0) {
    return replaced;
  }

  return `${replaced}${"=".repeat(4 - remainder)}`;
}
