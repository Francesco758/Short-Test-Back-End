function errorHandler(err, req, res, next) {
  console.error('❌ Error:', err);

  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  // Handle Prisma errors
  if (err.code) {
    switch (err.code) {
      case 'P2002':
        status = 409;
        message = 'Duplicate entry - resource already exists';
        break;
      case 'P2025':
        status = 404;
        message = 'Record not found';
        break;
      case 'P2003':
        status = 400;
        message = 'Invalid reference - related record not found';
        break;
    }
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    status = 401;
    message = 'Invalid token';
  }
  
  if (err.name === 'TokenExpiredError') {
    status = 401;
    message = 'Token expired';
  }

  const payload = { 
    error: message,
    timestamp: new Date().toISOString()
  };

  // Add stack trace in development
  if (process.env.NODE_ENV === 'development') {
    payload.stack = err.stack;
    if (err.details) payload.details = err.details;
  }

  // Add validation errors if any
  if (err.errors) {
    payload.validationErrors = err.errors;
  }

  return res.status(status).json(payload);
}

module.exports = errorHandler;