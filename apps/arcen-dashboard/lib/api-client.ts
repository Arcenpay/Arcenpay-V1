import { BACKEND_URL } from "@/lib/config";

const AUTH_DEBUG_PREFIX = "[DEBUG-auth-20260907]";

function backendPath(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const versionedPath = normalizedPath.startsWith("/api/v1/")
    ? normalizedPath
    : normalizedPath.replace(/^\/api\//, "/api/v1/");
  return `${BACKEND_URL.replace(/\/$/, "")}${versionedPath}`;
}

export function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const inputUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const nextInit: RequestInit = {
    ...init,
    credentials: init?.credentials ?? "include",
    mode: "cors",
  };

  const url = /^https?:\/\//i.test(inputUrl) ? inputUrl : backendPath(inputUrl);
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const parsedUrl = new URL(url);
  const isAuthRequest = parsedUrl.pathname.includes("/api/v1/auth/");
  if (isAuthRequest) {
    console.info(AUTH_DEBUG_PREFIX, "request", {
      method,
      origin: parsedUrl.origin,
      path: parsedUrl.pathname,
      credentials: nextInit.credentials,
    });
  }

  const logResponse = (response: Response): Response => {
    if (isAuthRequest) {
      console.info(AUTH_DEBUG_PREFIX, "response", {
        method,
        origin: parsedUrl.origin,
        path: parsedUrl.pathname,
        status: response.status,
        ok: response.ok,
      });
    }
    return response;
  };

  if (input instanceof Request) {
    return fetch(new Request(url, input), nextInit).then(logResponse);
  }

  return fetch(url, nextInit).then(logResponse);
}
