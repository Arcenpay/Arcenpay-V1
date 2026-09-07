import { BACKEND_URL } from "@/lib/config";

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
  const url = /^https?:\/\//i.test(inputUrl) ? inputUrl : backendPath(inputUrl);
  const nextInit: RequestInit = {
    ...init,
    credentials: init?.credentials ?? "include",
    mode: "cors",
  };

  if (input instanceof Request) {
    return fetch(new Request(url, input), nextInit);
  }

  return fetch(url, nextInit);
}
