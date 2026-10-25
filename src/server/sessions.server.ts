import { createHash, randomBytes } from "node:crypto";

import { db } from "~/server/db.server";
import { env } from "~/server/env.server";

const sessionCookie = "flint_session";
const sessionDays = 30;
const secure = env.APP_URL.startsWith("https:");

export const newSecret = () => randomBytes(32).toString("base64url");

export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const readCookie = (request: Request, name: string) =>
  new Bun.CookieMap(request.headers.get("cookie") ?? "").get(name);

export const serializeCookie = (
  name: string,
  value: string,
  options: { maxAge: number; path: string }
) =>
  new Bun.Cookie(name, value, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    ...options,
  }).serialize();

export const createSession = async (userId: string) => {
  const token = newSecret();

  await db`delete from sessions where expires_at < now()`;
  await db`
    insert into sessions (token_hash, user_id, expires_at)
    values (
      ${hashToken(token)},
      ${userId},
      now() + make_interval(days => ${sessionDays})
    )
  `;

  return serializeCookie(sessionCookie, token, {
    maxAge: sessionDays * 24 * 60 * 60,
    path: "/",
  });
};

export const findSessionUser = async (request: Request) => {
  const token = readCookie(request, sessionCookie);

  if (token === null) {
    return null;
  }

  const rows: { userId: string }[] = await db`
    select user_id as "userId" from sessions
    where token_hash = ${hashToken(token)} and expires_at > now()
  `;

  return rows[0]?.userId ?? null;
};

export const deleteSession = async (request: Request) => {
  const token = readCookie(request, sessionCookie);

  if (token !== null) {
    await db`delete from sessions where token_hash = ${hashToken(token)}`;
  }

  return serializeCookie(sessionCookie, "", { maxAge: 0, path: "/" });
};
