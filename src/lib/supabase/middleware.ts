import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Refreshes the organizer's Supabase session on every request and guards the
 * designer portal (/ontwerp/**) behind authentication.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If Supabase env vars are missing/misconfigured, don't hard-500 the whole
  // site from middleware — let requests through. The portal will still refuse
  // access because auth can't succeed without a configured backend.
  if (!url || !anonKey) {
    if (request.nextUrl.pathname.startsWith("/ontwerp") && request.nextUrl.pathname !== "/ontwerp/login") {
      const to = request.nextUrl.clone();
      to.pathname = "/ontwerp/login";
      return NextResponse.redirect(to);
    }
    return response;
  }

  let user = null;
  try {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch {
    // Misconfigured/unreachable backend — never 500 the whole site from
    // middleware; treat the request as unauthenticated.
    user = null;
  }

  const path = request.nextUrl.pathname;
  const isPortal = path.startsWith("/ontwerp");
  const isLogin = path === "/ontwerp/login";

  if (isPortal && !isLogin && !user) {
    const to = request.nextUrl.clone();
    to.pathname = "/ontwerp/login";
    to.searchParams.set("next", path);
    return NextResponse.redirect(to);
  }

  if (isLogin && user) {
    const to = request.nextUrl.clone();
    to.pathname = "/ontwerp";
    to.search = "";
    return NextResponse.redirect(to);
  }

  return response;
}
