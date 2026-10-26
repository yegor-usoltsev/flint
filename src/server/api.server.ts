// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type {
  Body as EndpointBody,
  Endpoint,
  Params as EndpointParams,
  ResponseOf,
} from "~/lib/endpoints";
import { db } from "~/server/db.server";
import { env } from "~/server/env.server";
import { log } from "~/server/log.server";
import { findSessionUser, hashToken } from "~/server/sessions.server";

export interface Actor {
  tokenId?: string;
  userId: string;
  workspaceIds?: string[];
}

export class ApiError extends Error {
  readonly code: string;
  readonly current: object | undefined;
  readonly status: number;

  // oxlint-disable-next-line anti-slop/no-object-parameters -- A 409 carries whichever canonical object conflicted.
  constructor(status: number, code: string, message: string, current?: object) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.current = current;
    this.status = status;
  }
}

const noStore = { "Cache-Control": "no-store" };
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const appOrigin = new URL(env.APP_URL).origin;

export const errorResponse = (
  status: number,
  code: string,
  message: string,
  // oxlint-disable-next-line anti-slop/no-object-parameters -- A 409 carries whichever canonical object conflicted.
  current?: object
) =>
  Response.json(
    { error: { code, current, message } },
    { headers: noStore, status }
  );

declare const createdBody: unique symbol;

export type Created<Value> = Response & { readonly [createdBody]: Value };

export const created = <Value extends object>(body: Value) =>
  // SAFETY: the brand only records the body type for endpoint checks.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- See the SAFETY note.
  Response.json(body, { headers: noStore, status: 201 }) as Created<Value>;

export const methodNotAllowed = () =>
  errorResponse(405, "method_not_allowed", "Method not allowed");

export const isSameOrigin = (request: Request) => {
  const site = request.headers.get("sec-fetch-site");

  if (site !== null) {
    return site === "same-origin";
  }

  return request.headers.get("origin") === appOrigin;
};

const findTokenActor = async (header: string): Promise<Actor> => {
  const token = /^Bearer\s+(?<token>\S+)$/iu.exec(header)?.groups?.["token"];

  const rows: {
    id: string;
    restricted: boolean;
    stale: boolean;
    userId: string;
    workspaceIds: string[];
  }[] =
    token === undefined
      ? []
      : await db`
          select t.id, t.user_id as "userId", t.restricted,
            (t.last_used_at is null
              or t.last_used_at < now() - interval '1 minute') as stale,
            array(
              select a.workspace_id::text from api_token_workspaces a
              where a.token_id = t.id
            ) as "workspaceIds"
          from api_tokens t
          where token_hash = ${hashToken(token)} and revoked_at is null
        `;

  const [row] = rows;

  if (row === undefined) {
    throw new ApiError(401, "unauthorized", "Invalid API token");
  }

  if (row.stale) {
    await db`
      update api_tokens set last_used_at = now()
      where id = ${row.id} and revoked_at is null
        and (last_used_at is null or last_used_at < now() - interval '1 minute')
    `;
  }

  return row.restricted
    ? {
        tokenId: row.id,
        userId: row.userId,
        workspaceIds: [...row.workspaceIds],
      }
    : { tokenId: row.id, userId: row.userId };
};

export const resolveActor = async (request: Request): Promise<Actor> => {
  const authorization = request.headers.get("authorization");

  if (authorization !== null) {
    return await findTokenActor(authorization);
  }

  const userId = await findSessionUser(request);

  if (userId === null) {
    throw new ApiError(401, "unauthorized", "Sign in required");
  }

  if (!safeMethods.has(request.method) && !isSameOrigin(request)) {
    throw new ApiError(403, "forbidden", "Cross-site request rejected");
  }

  return { userId };
};

export const readBody = async <Schema extends v.GenericSchema>(
  request: Request,
  schema: Schema
) => {
  const body: unknown = await request.json().catch(() => {
    throw new ApiError(400, "invalid_request", "Request body must be JSON");
  });

  return v.parse(schema, body);
};

interface ApiContext<Params> {
  actor: Actor;
  params: Params;
  request: Request;
}

export const apiHandler =
  <Params = object>(
    handler: (context: ApiContext<Params>) => Promise<object | undefined>
  ) =>
  async ({ params, request }: { params: Params; request: Request }) => {
    try {
      const actor = await resolveActor(request);
      const result = await handler({ actor, params, request });

      if (result instanceof Response) {
        return result;
      }

      if (result === undefined) {
        return new Response(null, { headers: noStore, status: 204 });
      }

      return Response.json(result, { headers: noStore });
    } catch (error) {
      if (error instanceof ApiError) {
        return errorResponse(
          error.status,
          error.code,
          error.message,
          error.current
        );
      }

      if (v.isValiError(error)) {
        return errorResponse(400, "invalid_request", v.summarize(error.issues));
      }

      log.error({ err: error }, "API request failed");

      return errorResponse(500, "internal", "Internal server error");
    }
  };

type EndpointResult<E extends Endpoint> =
  ResponseOf<E> extends object
    ? Created<ResponseOf<E>> | ResponseOf<E>
    : ResponseOf<E>;

interface EndpointContext<E extends Endpoint> extends ApiContext<
  EndpointParams<E>
> {
  body: <Schema extends v.GenericSchema<EndpointBody<E>, unknown>>(
    schema: Schema
  ) => Promise<v.InferOutput<Schema>>;
}

export const endpoint = <E extends Endpoint>(
  handler: (context: EndpointContext<E>) => Promise<EndpointResult<E>>
) =>
  apiHandler<EndpointParams<E>>(
    async (context) =>
      await handler({
        ...context,
        body: async (schema) => await readBody(context.request, schema),
      })
  );
