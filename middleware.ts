import { NextRequest, NextResponse } from "next/server";
import { match } from "@formatjs/intl-localematcher";
import Negotiator from "negotiator";

const CANONICAL = new Map([
  ["en-us", "en-US"],
  ["en", "en"],
  ["pt-br", "pt-BR"],
  ["pt", "pt"],
]);
const LOCALES = Array.from(CANONICAL.values());
const defaultLocale = "en-US";

const LOCALE_RE = /^\/([a-z]{2}(?:-[a-z]{2})?)(?=\/|$)/i;

function getLocale(request: NextRequest) {
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => (headers[k] = v));
  const negotiator = new Negotiator({ headers });
  const languages = negotiator.languages();
  const best = match(languages, LOCALES, defaultLocale);
  return best;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const m = pathname.match(LOCALE_RE);

  if (m) {
    // Há um "locale" no início do path – normalize para canônico
    const foundLower = m[1].toLowerCase();
    const canonical = CANONICAL.get(foundLower)!; // "pt-BR", "en-US", etc.
    if (m[1] !== canonical) {
      // Redireciona /pt-br/... -> /pt-BR/...
      const rest = pathname.slice(m[0].length) || "/";
      const url = request.nextUrl.clone();
      url.pathname = `/${canonical}${rest === "/" ? "" : rest}`;
      return NextResponse.redirect(url);
    }
    // Já está canônico: siga o fluxo
    return NextResponse.next();
  }

  // Não há locale no path: prefixe com o detectado
  const locale = getLocale(request); // canônico
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
