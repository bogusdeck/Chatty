const rateLimit = require("express-rate-limit");

function createLimiter(options) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    ...options
  });
}

module.exports = {
  globalLimiter: createLimiter({
    windowMs: 60 * 1000,
    max: 120,
    message: { error: "Too many requests. Please slow down." }
  }),
  authLimiter: createLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: "Too many login attempts. Try again later." }
  })
};
