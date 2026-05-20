import crypto from "crypto";

const DEFAULT_UI_SESSION_PROTECTED_PATHS = [
  "/api/tasks/triage",
  "/api/agent/run",
  "/api/tasks/enqueue",
  "/api/tasks/dispatch-next",
  "/api/tasks/remove",
  "/api/tasks/abort",
  "/api/tasks/answer",
  "/api/tasks/reshape-issues/reset",
  "/api/state/reset-simple-project",
  "/api/regressions/run",
  "/api/app/config",
  "/api/brains/config"
];

const DEFAULT_INTAKE_RATE_LIMIT_PATHS = [
  "/api/tasks/triage",
  "/api/agent/run",
  "/api/tasks/enqueue"
];

export function createObserverAdminSecurity({
  port,
  protectedPaths = DEFAULT_UI_SESSION_PROTECTED_PATHS,
  rateLimitPaths = DEFAULT_INTAKE_RATE_LIMIT_PATHS,
  adminUiToken = crypto.randomBytes(24).toString("hex"),
  rateLimitWindowMs = Math.max(
    1000,
    Math.min(Number(process.env.OBSERVER_INTAKE_RATE_LIMIT_WINDOW_MS || 60_000), 10 * 60 * 1000)
  ),
  rateLimitMax = Math.max(
    5,
    Math.min(Number(process.env.OBSERVER_INTAKE_RATE_LIMIT_MAX || 40), 500)
  )
} = {}) {
  const normalizedPort = Number(port || process.env.PORT || 3220);
  const protectedPathList = Array.isArray(protectedPaths) ? protectedPaths.slice() : [];
  const rateLimitPathSet = new Set(Array.isArray(rateLimitPaths) ? rateLimitPaths : []);
  const rateLimitBuckets = new Map();

  function isSafeRequestMethod(method = "GET") {
    const normalized = String(method || "GET").trim().toUpperCase();
    return normalized === "GET" || normalized === "HEAD" || normalized === "OPTIONS";
  }

  function isLoopbackAddress(value = "") {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return normalized === "::1"
      || normalized === "127.0.0.1"
      || normalized.startsWith("::ffff:127.0.0.1");
  }

  function isLoopbackRequest(req = {}) {
    return isLoopbackAddress(
      req.socket?.remoteAddress
        || req.connection?.remoteAddress
        || req.ip
        || ""
    );
  }

  function isTrustedLocalOrigin(origin = "") {
    const normalized = String(origin || "").trim();
    if (!normalized) {
      return false;
    }
    try {
      const parsed = new URL(normalized);
      if (parsed.protocol !== "http:") {
        return false;
      }
      const originPort = String(parsed.port || "80").trim();
      if (originPort !== String(normalizedPort)) {
        return false;
      }
      return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    } catch {
      return false;
    }
  }

  function isTrustedSameHostOrigin(origin = "", req = {}) {
    const normalized = String(origin || "").trim();
    const requestHost = String(req.headers?.host || "").trim().toLowerCase();
    if (!normalized || !requestHost) {
      return false;
    }
    try {
      const parsed = new URL(normalized);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false;
      }
      return String(parsed.host || "").trim().toLowerCase() === requestHost;
    } catch {
      return false;
    }
  }

  function isTrustedLocalRequestOrigin(req = {}) {
    const origin = String(req.headers?.origin || "").trim();
    const referer = String(req.headers?.referer || "").trim();
    if (origin) {
      return isTrustedLocalOrigin(origin) || isTrustedSameHostOrigin(origin, req);
    }
    if (referer) {
      return isTrustedLocalOrigin(referer) || isTrustedSameHostOrigin(referer, req);
    }
    return false;
  }

  function isValidAdminToken(value = "") {
    const token = String(value || "").trim();
    if (!token) {
      return false;
    }
    const expected = Buffer.from(adminUiToken);
    const provided = Buffer.from(token);
    return expected.length === provided.length
      && crypto.timingSafeEqual(expected, provided);
  }

  function validateAdminRequest(req = {}) {
    const hasTrustedOrigin = isTrustedLocalRequestOrigin(req);
    if (!isLoopbackRequest(req) && !hasTrustedOrigin) {
      return false;
    }
    if (!isSafeRequestMethod(req.method) && !hasTrustedOrigin) {
      return false;
    }
    const token = String(req.headers?.["x-admin-token"] || "").trim();
    return isValidAdminToken(token);
  }

  function rateLimitKeyForRequest(req = {}, scope = "intake") {
    const address = String(req.socket?.remoteAddress || req.connection?.remoteAddress || req.ip || "unknown").trim().toLowerCase();
    const method = String(req.method || "GET").trim().toUpperCase();
    const routePath = String(req.path || req.originalUrl || "").trim().toLowerCase();
    return `${scope}:${address}:${method}:${routePath}`;
  }

  function checkSlidingWindowRateLimit(req = {}, {
    scope = "intake",
    maxRequests = rateLimitMax,
    windowMs = rateLimitWindowMs
  } = {}) {
    const now = Date.now();
    const key = rateLimitKeyForRequest(req, scope);
    const threshold = now - windowMs;
    const prior = Array.isArray(rateLimitBuckets.get(key))
      ? rateLimitBuckets.get(key).filter((timestamp) => Number(timestamp || 0) > threshold)
      : [];
    if (prior.length >= maxRequests) {
      const retryAfterMs = Math.max(1000, windowMs - (now - prior[0]));
      rateLimitBuckets.set(key, prior);
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000)
      };
    }
    prior.push(now);
    rateLimitBuckets.set(key, prior);
    return {
      allowed: true,
      retryAfterSeconds: 0
    };
  }

  function registerAdminSecurityMiddleware(app) {
    app.get("/api/admin-token", (req, res) => {
      if (!isTrustedLocalRequestOrigin(req)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      res.json({ ok: true, token: adminUiToken });
    });

    app.use("/api/plugins", (req, res, next) => {
      if (!validateAdminRequest(req)) {
        return res.status(403).json({ ok: false, error: "Admin token required" });
      }
      next();
    });

    app.use(protectedPathList, (req, res, next) => {
      if (isSafeRequestMethod(req.method)) {
        return next();
      }
      if (!validateAdminRequest(req)) {
        return res.status(403).json({ ok: false, error: "Admin token required" });
      }
      next();
    });

    app.use((req, res, next) => {
      if (!rateLimitPathSet.has(String(req.path || "").trim())) {
        return next();
      }
      if (String(req.method || "GET").trim().toUpperCase() !== "POST") {
        return next();
      }
      const rateLimit = checkSlidingWindowRateLimit(req);
      if (!rateLimit.allowed) {
        res.set("Retry-After", String(rateLimit.retryAfterSeconds));
        return res.status(429).json({
          ok: false,
          error: "Too many intake requests. Please slow down and try again shortly."
        });
      }
      next();
    });
  }

  return {
    adminUiToken,
    checkSlidingWindowRateLimit,
    isSafeRequestMethod,
    isTrustedLocalRequestOrigin,
    registerAdminSecurityMiddleware,
    validateAdminRequest
  };
}
