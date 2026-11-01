import { NextResponse, type NextRequest } from 'next/server';
import { decideHostRouting, hostRoutingConfigFromEnv } from '@/lib/host-routing';
import { isProductPreviewRequest, PREVIEW_RESPONSE_HEADERS } from '@/lib/storefront/product-route';

/**
 * ZP-485: host-based routing. The decision lives in src/lib/host-routing.ts.
 * - Storefront host: clean URLs rewritten onto /site/**, everything private 404.
 * - Admin host / unknown host / no env: unchanged, plus X-Robots-Tag noindex.
 */
export function proxy(request: NextRequest) {
  const decision = decideHostRouting(
    // Host header first; the request URL's host only if the header is absent
    // (Next derives that URL from the same header, so the two agree).
    { host: request.headers.get('host') ?? request.nextUrl.host, pathname: request.nextUrl.pathname },
    hostRoutingConfigFromEnv()
  );

  switch (decision.action) {
    case 'rewrite': {
      const url = request.nextUrl.clone();
      url.pathname = decision.pathname;
      return withPreviewHeaders(request, NextResponse.rewrite(url));
    }
    case 'redirect': {
      const url = request.nextUrl.clone();
      url.pathname = decision.pathname;
      return withPreviewHeaders(request, NextResponse.redirect(url, 308));
    }
    case 'not-found':
      return new NextResponse('Not Found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    case 'next': {
      const response = NextResponse.next();
      if (decision.noindex) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
      return withPreviewHeaders(request, response);
    }
  }
}

/**
 * ZP-490: a product URL with `?preview=<token>` (valid or not) must not leak
 * the token through Referer or into a shared cache. A page cannot set response
 * headers in Next 16, so the proxy adds them (src/lib/storefront/product-route.ts).
 */
function withPreviewHeaders(request: NextRequest, response: NextResponse): NextResponse {
  if (isProductPreviewRequest(request.nextUrl.pathname, request.nextUrl.searchParams)) {
    for (const [name, value] of Object.entries(PREVIEW_RESPONSE_HEADERS)) response.headers.set(name, value);
  }
  return response;
}

export const config = {
  // Everything except build assets and the image optimiser (never host-specific).
  matcher: ['/((?!_next/static|_next/image).*)'],
};
