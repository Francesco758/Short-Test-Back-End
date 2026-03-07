const companyService = require('../../services/admin/companyService');

async function createCompany(req, res, next) {
  try {
    const company = await companyService.createCompany(req.body);
    res.status(201).json(company);
  } catch (err) {
    next(err);
  }
}

async function getAllCompanies(req, res, next) {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const companies = await companyService.getAllCompanies({ page, limit, search });
    res.json(companies);
  } catch (err) {
    next(err);
  }
}

async function getCompanyById(req, res, next) {
  try {
    const company = await companyService.getCompanyById(parseInt(req.params.id));
    res.json(company);
  } catch (err) {
    next(err);
  }
}

async function updateCompany(req, res, next) {
  try {
    const company = await companyService.updateCompany(parseInt(req.params.id), req.body);
    res.json(company);
  } catch (err) {
    next(err);
  }
}

async function deleteCompany(req, res, next) {
  try {
    await companyService.deleteCompany(parseInt(req.params.id));
    res.json({ message: 'Company deleted successfully' });
  } catch (err) {
    next(err);
  }
}

async function getCompanyUsers(req, res, next) {
  try {
    const users = await companyService.getCompanyUsers(parseInt(req.params.companyId));
    res.json(users);
  } catch (err) {
    next(err);
  }
}

async function getCompanyReports(req, res, next) {
  try {
    const reports = await companyService.getCompanyReports(parseInt(req.params.companyId));
    res.json(reports);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createCompany,
  getAllCompanies,
  getCompanyById,
  updateCompany,
  deleteCompany,
  getCompanyUsers,
  getCompanyReports
};