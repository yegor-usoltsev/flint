import { createHash, timingSafeEqual } from "node:crypto";

// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { errorResponse, isSameOrigin } from "~/server/api.server";
import { env } from "~/server/env.server";
import { log } from "~/server/log.server";
import {
  createSession,
  deleteSession,
  newSecret,
  readCookie,
  serializeCookie,
} from "~/server/sessions.server";
import { signIn } from "~/server/users.server";

const attemptCookie = "flint_oauth";
const attemptPath = "/api/auth";
const redirectUri = new URL("/api/auth/callback", env.APP_URL).href;
const giteaOrigin = new URL(env.GITEA_URL).origin;
const giteaPublicOrigin = new URL(env.GITEA_PUBLIC_URL).origin;

const TokenSchema = v.object({
  access_token: v.pipe(v.string(), v.nonEmpty()),
});

const UserinfoSchema = v.object({
  email: v.optional(v.string(), ""),
  name: v.optional(v.string(), ""),
  picture: v.optional(v.string(), ""),
  preferred_username: v.pipe(v.string(), v.nonEmpty()),
  sub: v.pipe(v.string(), v.nonEmpty()),
});

const redirect = (location: string, cookies: string[]) => {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Location: location,
  });

  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }

  return new Response(null, { headers, status: 302 });
};

const sameSecret = (left: string, right: string) => {
  const [a, b] = [Buffer.from(left), Buffer.from(right)];

  return a.length === b.length && timingSafeEqual(a, b);
};

const appOrigin = new URL(env.APP_URL).origin;

const safeReturnTo = (value: string | null | undefined) => {
  if (value === null || value === undefined || !/^\/(?![/\\])/u.test(value)) {
    return "/";
  }

  const url = new URL(value, appOrigin);

  return url.origin === appOrigin ? url.pathname + url.search + url.hash : "/";
};

export const startLogin = ({ request }: { request: Request }) => {
  const returnTo = safeReturnTo(
    new URL(request.url).searchParams.get("returnTo")
  );

  const state = newSecret();
  const verifier = newSecret();
  const authorize = new URL("/login/oauth/authorize", env.GITEA_PUBLIC_URL);
  authorize.search = new URLSearchParams({
    client_id: env.GITEA_CLIENT_ID,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email",
    state,
  }).toString();

  return redirect(authorize.href, [
    serializeCookie(
      attemptCookie,
      `${state}.${verifier}.${Buffer.from(returnTo).toString("base64url")}`,
      {
        maxAge: 600,
        path: attemptPath,
      }
    ),
  ]);
};

const fetchProfile = async (code: string, verifier: string) => {
  const tokenResponse = await fetch(
    new URL("/login/oauth/access_token", env.GITEA_URL),
    {
      body: new URLSearchParams({
        client_id: env.GITEA_CLIENT_ID,
        client_secret: env.GITEA_CLIENT_SECRET,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
      headers: { Accept: "application/json" },
      method: "POST",
    }
  );

  if (!tokenResponse.ok) {
    throw new Error(`Gitea token exchange answered ${tokenResponse.status}`);
  }

  const { access_token: accessToken } = v.parse(
    TokenSchema,
    await tokenResponse.json()
  );

  const userinfoResponse = await fetch(
    new URL("/login/oauth/userinfo", env.GITEA_URL),
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!userinfoResponse.ok) {
    throw new Error(`Gitea userinfo answered ${userinfoResponse.status}`);
  }

  const userinfo = v.parse(UserinfoSchema, await userinfoResponse.json());

  return {
    avatarUrl: userinfo.picture.startsWith(`${giteaOrigin}/`)
      ? giteaPublicOrigin + userinfo.picture.slice(giteaOrigin.length)
      : userinfo.picture,
    email: userinfo.email,
    giteaId: userinfo.sub,
    name: userinfo.name,
    username: userinfo.preferred_username,
  };
};

export const finishLogin = async ({ request }: { request: Request }) => {
  const clearAttempt = serializeCookie(attemptCookie, "", {
    maxAge: 0,
    path: attemptPath,
  });

  const params = new URL(request.url).searchParams;

  const [state, verifier, returnTo] =
    readCookie(request, attemptCookie)?.split(".") ?? [];

  const code = params.get("code");
  const returnedState = params.get("state");

  const valid =
    state !== undefined &&
    returnedState !== null &&
    sameSecret(state, returnedState);

  try {
    if (!valid || verifier === undefined || code === null) {
      throw new Error(
        `OAuth callback rejected: ${params.get("error") ?? "state mismatch"}`
      );
    }

    const userId = await signIn(await fetchProfile(code, verifier));

    return redirect(
      safeReturnTo(Buffer.from(returnTo ?? "", "base64url").toString()),
      [clearAttempt, await createSession(userId)]
    );
  } catch (error) {
    log.warn({ err: error }, "Gitea login failed");

    return redirect("/?error=login", [clearAttempt]);
  }
};

export const logout = async ({ request }: { request: Request }) => {
  if (!isSameOrigin(request)) {
    return errorResponse(403, "forbidden", "Cross-site request rejected");
  }

  return new Response(null, {
    headers: {
      "Cache-Control": "no-store",
      "Set-Cookie": await deleteSession(request),
    },
    status: 204,
  });
};
