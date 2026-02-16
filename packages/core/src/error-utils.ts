export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function formatEmptyResponseMessage(response: Response): string {
  const responseUrl = response.url || "unknown endpoint";

  return `WB API returned empty response (status ${response.status}, url ${responseUrl})`;
}
