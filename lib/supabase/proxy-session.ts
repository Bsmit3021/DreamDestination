import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getClientEnv } from "@/lib/env";
import { ROUTES, resolveAuthRedirect } from "@/lib/routes";
import type { Database } from "@/types/database";

/**
 * Supabase session refresh for Next.js 16 Proxy (the renamed Middleware).
 *
 * Two jobs, in this order:
 *
 * 1. Refresh the auth cookies. Server Components cannot write cookies, so if
 *    this did not run the access token would expire and never be renewed.
 * 2. Perform an *optimistic* redirect for obviously-wrong destinations.
 *
 * Step 2 is a UX shortcut, not a security control. Next.js's own docs are
 * explicit that Proxy "should not be used as a full session management or
 * authorization solution", so the authoritative check lives server-side in
 * `app/(protected)/layout.tsx`, which calls `getUser()` on every render.
 *
 * The anon key is used here deliberately. The service-role key must never
 * reach request-handling code.
 */
export async function updateSession(request: NextRequest) {
  // This response carries any refreshed cookies back to the browser. It must
  // be the object we ultimately return, or the refresh is silently dropped.
  let response = NextResponse.next({ request });

  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } =
    getClientEnv();

  const supabase = createServerClient<Database>(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          response = NextResponse.next({ request });

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() revalidates the token with Supabase Auth and triggers the
  // refresh. Do not replace it with getSession(), which trusts the cookie
  // without verifying it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const target = resolveAuthRedirect({
    pathname,
    isAuthenticated: user !== null,
  });

  if (target) {
    const url = new URL(target, request.url);

    if (target === ROUTES.signIn) {
      // Preserve where they were heading so sign-in can return them there.
      url.searchParams.set("redirectTo", pathname);
    }

    return NextResponse.redirect(url);
  }

  return response;
}
