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
  };

  // Relative URLs must remain on the dashboard origin. Its /api route is the
  // backend-for-frontend proxy that can safely persist the .arcenpay.com
  // session cookie when the API itself runs on a different host (e.g. Railway).
  if (!/^https?:\/\//i.test(inputUrl)) {
    return fetch(inputUrl, nextInit);
  }

  const url = inputUrl;
  if (input instanceof Request) {
    return fetch(new Request(url, input), nextInit);
  }

  return fetch(url, nextInit);
}
