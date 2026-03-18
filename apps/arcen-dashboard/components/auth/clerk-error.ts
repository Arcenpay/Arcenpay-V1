type ClerkErrorLike = {
  errors?: Array<{
    message?: string;
    longMessage?: string;
  }>;
};

export function getClerkErrorMessage(error: unknown, fallback: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "errors" in error &&
    Array.isArray((error as ClerkErrorLike).errors)
  ) {
    const [firstError] = (error as ClerkErrorLike).errors ?? [];
    if (firstError?.longMessage) {
      return firstError.longMessage;
    }
    if (firstError?.message) {
      return firstError.message;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
