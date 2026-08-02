const logger = require('../utils/logger');

function errorHandler(err, req, res, _next) {
  const requestId = req?.id || 'unknown';

  // Use custom error code if present, otherwise derive from Prisma/JWT errors
  let status = err.status || err.statusCode || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'Internal Server Error';

  // Handle Prisma errors
  if (err.code && err.code.startsWith('P')) {
    switch (err.code) {
      case 'P2002':
        status = 409;
        code = 'DUPLICATE_ENTRY';
        message = 'Duplicate entry - resource already exists';
        break;
      case 'P2025':
        status = 404;
        code = 'NOT_FOUND';
        message = 'Record not found';
        break;
      case 'P2003':
        status = 400;
        code = 'INVALID_REFERENCE';
        message = 'Invalid reference - related record not found';
        break;
      default:
        status = 500;
        code = 'DATABASE_ERROR';
        break;
    }
  }

  // Handle rate limit errors
  if (status === 429 || err.name === 'RateLimitError') {
    code = 'RATE_LIMIT';
    message = err.message || 'Too many requests. Please wait before trying again.';
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    status = 401;
    code = 'INVALID_TOKEN';
    message = 'Invalid token';
  }

  if (err.name === 'TokenExpiredError') {
    status = 401;
    code = 'TOKEN_EXPIRED';
    message = 'Token expired';
  }

  const logData = {
    requestId,
    status,
    code,
    err,
    path: req?.originalUrl || req?.url || 'unknown',
    method: req?.method || 'unknown',
    userId: req?.user?.id
  };

  if (status >= 500) {
    logger.error(logData, message);
  } else if (status >= 400) {
    logger.warn(logData, message);
  } else {
    logger.info(logData, message);
  }

  const payload = {
    error: message,
    code,
    status: status >= 500 ? 'error' : 'fail',
    requestId,
    timestamp: new Date().toISOString()
  };

  if (process.env.NODE_ENV === 'development') {
    payload.stack = err.stack;
    if (err.details) payload.details = err.details;
  }

  if (err.errors || err.details) {
    payload.validationErrors = err.errors || err.details;
  }

  return res.status(status).json(payload);
}

module.exports = errorHandler;