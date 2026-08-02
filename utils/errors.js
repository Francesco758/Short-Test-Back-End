class AppError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource conflict', code = 'CONFLICT') {
    super(message, 409, code);
    this.name = 'ConflictError';
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Too many requests. Please wait before trying again.') {
    super(message, 429, 'RATE_LIMIT');
    this.name = 'RateLimitError';
  }
}

class ValidationError extends AppError {
  constructor(message = 'Invalid input', details = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    this.details = details;
  }
}

class AuthError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTH_ERROR');
    this.name = 'AuthError';
  }
}

module.exports = {
  AppError,
  ConflictError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  AuthError
};