/**
 * Result of a rate limit check.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * In-memory sliding-window rate limiter.
 * No external dependencies.
 */
export class RateLimiter {
  private store = new Map<string, { count: number; windowStart: number; windowMs: number }>();

  constructor() {
    // Periodic cleanup of expired entries (every 5 minutes) to prevent memory leaks
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.store.entries()) {
        if (now - value.windowStart >= value.windowMs) {
          this.store.delete(key);
        }
      }
    }, 5 * 60 * 1000);
    
    if (timer && timer.unref) {
      timer.unref();
    }
  }

  /**
   * Checks if a request is allowed based on the rate limit parameters.
   * @param key The unique key for the entity (e.g., user ID, IP address).
   * @param maxRequests The maximum number of requests allowed in the window.
   * @param windowMs The time window in milliseconds.
   * @returns An object indicating whether the request is allowed, remaining requests, and retry time.
   */
  checkRateLimit(key: string, maxRequests: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const record = this.store.get(key);

    if (!record || now - record.windowStart >= windowMs) {
      this.store.set(key, { count: 1, windowStart: now, windowMs });
      return { allowed: true, remaining: maxRequests - 1, retryAfterMs: 0 };
    }

    if (record.count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: windowMs - (now - record.windowStart),
      };
    }

    record.count++;
    this.store.set(key, record);
    return { allowed: true, remaining: maxRequests - record.count, retryAfterMs: 0 };
  }
}

// 3 Pre-configured instances
export const perUserLimiter = new RateLimiter();
export const perOrgHourLimiter = new RateLimiter();
export const perSessionLimiter = new RateLimiter();

// Default limiter for standalone function usage
const defaultLimiter = new RateLimiter();

/**
 * Export a checkRateLimit function that takes (key: string, maxRequests: number, windowMs: number).
 */
export function checkRateLimit(key: string, maxRequests: number, windowMs: number): RateLimitResult {
  return defaultLimiter.checkRateLimit(key, maxRequests, windowMs);
}

/**
 * Convenience function to check AI rate limits against user, organization, and session limits.
 * @param orgId The organization ID
 * @param userId The user ID
 * @param sessionId Optional session ID
 * @returns Result object with allowed status, and optionally error and retryAfterMs
 */
export function checkAIRateLimit(
  orgId: string, 
  userId: string, 
  sessionId?: string
): { allowed: boolean; error?: string; retryAfterMs?: number } {
  // perOrgHourLimiter — 200 requests per 3600 seconds
  const orgCheck = perOrgHourLimiter.checkRateLimit(`org:${orgId}`, 200, 3600 * 1000);
  if (!orgCheck.allowed) {
    return { allowed: false, error: 'Organization hourly rate limit exceeded.', retryAfterMs: orgCheck.retryAfterMs };
  }

  // perUserLimiter — 10 requests per 60 seconds
  const userCheck = perUserLimiter.checkRateLimit(`user:${userId}`, 10, 60 * 1000);
  if (!userCheck.allowed) {
    return { allowed: false, error: 'User rate limit exceeded.', retryAfterMs: userCheck.retryAfterMs };
  }

  // perSessionLimiter — 30 requests per session (86400 seconds)
  if (sessionId) {
    const sessionCheck = perSessionLimiter.checkRateLimit(`session:${sessionId}`, 30, 86400 * 1000);
    if (!sessionCheck.allowed) {
      return { allowed: false, error: 'Session rate limit exceeded.', retryAfterMs: sessionCheck.retryAfterMs };
    }
  }

  return { allowed: true };
}
