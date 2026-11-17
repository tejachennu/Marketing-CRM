import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isOwnHost } from '@/lib/commerce/store-host'

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const searchParams = request.nextUrl.searchParams

  // A business's own domain (shop.theirname.com): every page is its online store. API calls (cart,
  // order, payment) and Next's own files pass through untouched.
  // Visits through our store domain gateway (deploy/gateway) arrive for wamacrm.magnetora.in with the
  // customer's domain in X-Store-Domain and the gateway's key; anything else uses the request's own host.
  const gatewayKey = process.env.STORE_GATEWAY_KEY || ''
  const viaGateway = gatewayKey.length >= 16 && request.headers.get('x-gateway-key') === gatewayKey ? request.headers.get('x-store-domain') : null
  const host = (viaGateway || request.headers.get('x-forwarded-host') || request.headers.get('host') || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '')
  const seoFile = pathname === '/sitemap.xml' || pathname === '/robots.txt'
  if (host && !isOwnHost(host) && !pathname.startsWith('/_next') && !pathname.startsWith('/api') && (seoFile || !/\.[a-z0-9]{2,5}$/i.test(pathname))) {
    const url = request.nextUrl.clone()
    // The store's home, one product's page (/p/<id>), an info page (/info/returns), the site map and robots.txt;
    // every other address shows the home
    const product = pathname.match(/^\/p\/([0-9a-f-]{36})\/?$/i)?.[1]
    const info = pathname.match(/^\/info\/(about|shipping|returns|terms|privacy|contact)\/?$/)?.[1]
    const review = pathname.match(/^\/review\/([A-Za-z0-9_-]{16,30})\/?$/)?.[1]
    url.pathname = seoFile ? `/s/${host}${pathname}` : product ? `/s/${host}/p/${product.toLowerCase()}` : info ? `/s/${host}/info/${info}` : review ? `/s/${host}/review/${review}` : `/s/${host}`
    const forwarded = new Headers(request.headers)
    forwarded.set('x-store-via-domain', '1')
    return NextResponse.rewrite(url, { request: { headers: forwarded } })
  }

  // Skip middleware for static assets, API routes, and RSC payloads
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname === '/favicon.ico' ||
    searchParams.has('_rsc') // Skip React Server Component payload requests
  ) {
    return NextResponse.next()
  }

  // Protected routes that require authentication
  const isProtectedRoute = pathname.startsWith('/dashboard')

  // Check for auth session — use the user-logged-in flag cookie only
  // The actual token validation happens client-side and in API routes
  const userLoggedIn = request.cookies.get('user-logged-in')
  const isAuthenticated = !!userLoggedIn

  // If user is not authenticated and trying to access protected route, redirect to login
  if (isProtectedRoute && !isAuthenticated) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // If user is authenticated and trying to access public routes, redirect to dashboard
  if (isAuthenticated && (pathname === '/' || pathname === '/login' || pathname === '/signup')) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon\\.ico).*)',
  ],
}
