import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, isUnlocked } from "@/lib/passcode";

// Everything except the passcode page needs the unlock cookie.
export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/unlock")) return NextResponse.next();
  if (await isUnlocked(request.cookies.get(COOKIE)?.value)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/unlock";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
