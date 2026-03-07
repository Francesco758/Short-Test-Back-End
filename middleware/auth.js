const jwt = require('jsonwebtoken');
const { prisma } = require('../utils/prismaClient');

const SECRET = process.env.JWT_SECRET || 'devsecret';

function sendError(res, status, message, extra = {}) {
  return res.status(status).json({
    error: message,
    ...extra
  });
}

async function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || req.get('Authorization');
    if (!header) {
      return sendError(res, 401, 'Missing authentication token');
    }

    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return sendError(res, 401, 'Invalid authorization header format');
    }

    let payload;
    try {
      payload = jwt.verify(token, SECRET);
    } catch (e) {
      return sendError(res, 401, 'Invalid or expired token');
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: payload.id },
      include: { company: true }
    });

    if (!dbUser || dbUser.deletedAt) {
      return sendError(res, 401, 'User not found');
    }

    const { password: _pw, ...safeUser } = dbUser;
    req.user = safeUser;

    return next();
  } catch (err) {
    console.error('authRequired error:', err);
    return sendError(res, 500, 'Authentication error');
  }
}

function requireRole(roles) {
  const required = (Array.isArray(roles) ? roles : [roles])
    .map(r => String(r).toUpperCase());

  return function (req, res, next) {
    if (!req.user) {
      return sendError(res, 401, 'Authentication required');
    }

    const userRole = String(req.user.role || '').toUpperCase();
    if (!required.includes(userRole)) {
      return sendError(res, 403, 'Insufficient permissions', {
        required,
        current: userRole
      });
    }

    return next();
  };
}

// Role-specific middleware
const superAdminOnly = requireRole(['SUPER_ADMIN']);
const companyAdminOnly = requireRole(['COMPANY_ADMIN']);
const adminOnly = requireRole(['SUPER_ADMIN', 'COMPANY_ADMIN']);

// Company tenant isolation middleware
async function requireCompanyAccess(req, res, next) {
  if (!req.user) {
    return sendError(res, 401, 'Authentication required');
  }

  if (req.user.role === 'SUPER_ADMIN') {
    return next(); // Super admin can access all
  }

  if (!req.user.companyId) {
    return sendError(res, 403, 'Company account required');
  }

  // For company admins, ensure they only access their company's data
  req.companyId = req.user.companyId;
  next();
}

module.exports = {
  authRequired,
  requireRole,
  superAdminOnly,
  companyAdminOnly,
  adminOnly,
  requireCompanyAccess
};