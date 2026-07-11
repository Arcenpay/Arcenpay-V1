export class HttpResponseError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "HttpResponseError";
    this.status = status;
    this.payload = payload;
  }
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;

    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }

  return fallback;
}

export async function readJsonOrThrow<T>(
  response: Response,
  fallbackMessage = "Request failed",
): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new HttpResponseError(
      getErrorMessage(payload, fallbackMessage),
      response.status,
      payload,
    );
  }

  return payload as T;
}
