const rateLimit = require('express-rate-limit');
const { defaultKeyGenerator } = rateLimit;

const conversationStartLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many test starts. Please wait before starting another test.', retryAfter: '1 hour' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || defaultKeyGenerator(req)
});

const conversationMessageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many messages. Please slow down.', retryAfter: '1 minute' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || defaultKeyGenerator(req)
});

const conversationCompleteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  message: { error: 'Too many completion attempts. Please wait.', retryAfter: '1 hour' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || defaultKeyGenerator(req)
});

const companyQueryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'Too many AI queries. Please wait before asking another question.', retryAfter: '1 minute' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || defaultKeyGenerator(req)
});

const adminQueryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'Too many AI queries. Please wait before asking another question.', retryAfter: '1 minute' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || defaultKeyGenerator(req)
});

module.exports = {
  conversationStartLimiter,
  conversationMessageLimiter,
  conversationCompleteLimiter,
  companyQueryLimiter,
  adminQueryLimiter
};
