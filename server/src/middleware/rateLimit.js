const rateLimit = require('express-rate-limit');

// Generous enough to absorb normal mistyped-password retries, tight enough
// to blunt automated brute-force password guessing against login endpoints.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Please wait a few minutes and try again.' },
});

// Self-registration is public and creates a new client - keep it tight to
// deter signup spam/flooding.
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many signup attempts from this network. Please try again later.' },
});

module.exports = { loginLimiter, signupLimiter };
