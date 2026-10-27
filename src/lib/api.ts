import { queryOptions, useQuery } from "@tanstack/react-query";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type { ApiErrorBody, Me } from "~/lib/api-types";
import { clearStoredDrafts } from "~/lib/draft-storage";
import { endpointPath } from "~/lib/endpoints";
import type { Endpoint, RequestOptions, ResponseOf } from "~/lib/endpoints";
import { notifyError } from "~/lib/notify";

const ErrorBodySchema = v.object({
  error: v.object({
    code: v.string(),
    current: v.optional(v.unknown()),
    message: v.string(),
  }),
});

export class ApiError extends Error {
  readonly code: string;
  readonly current: unknown;
  readonly status: number;

  constructor(status: number, error: ApiErrorBody["error"]) {
    super(error.message);
    this.name = "ApiError";
    this.code = error.code;
    this.current = error.current;
    this.status = status;
  }
}

export const isNotFound = (error: Error) =>
  error instanceof ApiError && error.status === 404;

export const api = async <Result>(
  path: string,
  {
    body,
    expectedUser,
    method = "GET",
  }: { body?: unknown; expectedUser?: string; method?: string } = {}
): Promise<Result> => {
  const json = body !== undefined && !(body instanceof FormData);
  const headers = new Headers();

  if (json) {
    headers.set("Content-Type", "application/json");
  }

  if (expectedUser !== undefined) {
    headers.set("X-Flint-User", expectedUser);
  }

  const response = await fetch(`/api/v1${path}`, {
    body: json ? JSON.stringify(body) : (body ?? null),
    headers,
    method,
  });

  if (!response.ok) {
    const failure: unknown = await response.json().catch(() => null);
    const parsed = v.safeParse(ErrorBodySchema, failure);

    throw new ApiError(
      response.status,
      parsed.success
        ? parsed.output.error
        : { code: "http_error", message: `Request failed: ${response.status}` }
    );
  }

  // SAFETY: the endpoint at `path` answers with `Result`; 204 means undefined.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The API contract types the body.
  return (
    response.status === 204 ? undefined : await response.json()
  ) as Result;
};

export const request = async <E extends Endpoint>(
  endpoint: E,
  ...[options]: object extends RequestOptions<E>
    ? [RequestOptions<E>?]
    : [RequestOptions<E>]
) => {
  const { method, path } = endpointPath(
    endpoint,
    options?.params,
    options?.query
  );

  return await api<ResponseOf<E>>(path, { body: options?.body, method });
};

export const meQuery = queryOptions({
  queryFn: async () => {
    try {
      return await api<Me>("/me");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return null;
      }

      throw error;
    }
  },
  queryKey: ["me"],
});

export const useMe = () => useQuery(meQuery);

export const useUsername = () => useMe().data?.username ?? "";

export const signOut = async () => {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST" });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
  } catch (error) {
    notifyError("Not logged out")(
      error instanceof Error ? error : new Error(String(error))
    );

    return;
  }

  clearStoredDrafts();
  window.location.assign("/");
};
