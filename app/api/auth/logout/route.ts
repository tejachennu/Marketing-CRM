import { NextResponse } from 'next/server'

export async function POST() {
  // Create response to clear session
  const response = NextResponse.json(
    { success: true, message: 'Logged out successfully' },
    { status: 200 }
  )

  // Clear all auth-related cookies
  response.cookies.delete('supabase-auth-token')
  response.cookies.delete('user-logged-in')
  
  return response
}
