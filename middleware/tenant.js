// Tenant isolation middleware for company-specific data access
function ensureCompanyAccess(resourceCompanyId, user) {
  if (user.role === 'SUPER_ADMIN') return true;
  return resourceCompanyId === user.companyId;
}

function companyResourceGuard(resourceType) {
  return function(req, res, next) {
    if (req.user.role === 'SUPER_ADMIN') return next();
    
    const resourceId = req.params.companyId || req.body.companyId;
    if (resourceId && parseInt(resourceId) !== req.user.companyId) {
      return res.status(403).json({ error: 'Access denied to company resource' });
    }
    
    next();
  };
}

module.exports = {
  ensureCompanyAccess,
  companyResourceGuard
};