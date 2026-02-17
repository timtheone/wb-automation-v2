export function readRuntimeEnv(key: string): string | undefined {
  if (typeof Bun !== "undefined") {
    return Bun.env[key] ?? process.env[key];
  }

  return process.env[key];
}

export function readPositiveNumberEnv(key: string, fallback: number): number {
  const value = readRuntimeEnv(key);

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}
