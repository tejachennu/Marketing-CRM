import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const searchParams = request.nextUrl.searchParams

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
