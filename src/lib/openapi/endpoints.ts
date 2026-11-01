import type { paths } from "~/lib/openapi/paths.gen";

type Method = "delete" | "get" | "patch" | "post" | "put";

type ColonPath<Path extends string> =
  Path extends `${infer Head}{${infer Name}}${infer Tail}`
    ? `${Head}:${Name}${ColonPath<Tail>}`
    : Path;

type Entries = {
  [Path in keyof paths]: {
    [M in Method]: [paths[Path][M]] extends [undefined]
      ? never
      : [`${Uppercase<M>} ${ColonPath<Path>}`, paths[Path][M]];
  }[Method];
}[keyof paths];

export type OpenApiOperations = { [E in Entries as E[0]]: E[1] };

export type OpenApiEndpoint = keyof OpenApiOperations;

type Content<Value> = Value extends { content: infer Media } ? Media : never;

type Json<Media> = Media extends { "application/json": infer Value }
  ? Value
  : Media extends { "multipart/form-data": unknown }
    ? FormData
    : never;

type Success<Responses> = Responses extends { 200: infer Ok }
  ? Ok
  : Responses extends { 201: infer Made }
    ? Made
    : never;

export type OpenApiBody<E extends OpenApiEndpoint> =
  OpenApiOperations[E] extends { requestBody: infer Request }
    ? Json<Content<Request>>
    : undefined;

export type OpenApiQuery<E extends OpenApiEndpoint> =
  OpenApiOperations[E] extends { parameters: { query?: infer Value } }
    ? [Value] extends [undefined]
      ? undefined
      : NonNullable<Value>
    : undefined;

export type OpenApiResponse<E extends OpenApiEndpoint> =
  OpenApiOperations[E] extends { responses: infer Responses }
    ? Json<Content<Success<Responses>>>
    : never;
