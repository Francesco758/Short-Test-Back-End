const { prisma } = require('../../utils/prismaClient');

async function createCompany(data) {
  return prisma.company.create({ data, include: { users: true } });
}

async function getAllCompanies({ page, limit, search }) {
  const skip = (page - 1) * limit;
  const where = search ? { name: { contains: search, mode: 'insensitive' } } : {};
  
  const [companies, total] = await Promise.all([
    prisma.company.findMany({
      where,
      skip,
      take: limit,
      include: { 
        users: { where: { deletedAt: null } },
        _count: { select: { users: true, assignedTests: true } }
      },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.company.count({ where })
  ]);
  
  return { companies, total, page, limit };
}

async function getCompanyById(id) {
  return prisma.company.findUnique({
    where: { id },
    include: { 
      users: { where: { deletedAt: null } },
      assignedTests: { include: { test: true } }
    }
  });
}

async function updateCompany(id, data) {
  return prisma.company.update({ where: { id }, data });
}

async function deleteCompany(id) {
  return prisma.company.update({ 
    where: { id }, 
    data: { deletedAt: new Date() } 
  });
}

async function getCompanyUsers(companyId) {
  return prisma.user.findMany({
    where: { companyId, deletedAt: null },
    include: { 
      assignedTests: { 
        include: { test: true, report: true },
        where: { status: 'COMPLETED' }
      }
    }
  });
}

async function getCompanyReports(companyId) {
  return prisma.report.findMany({
    where: { userTest: { companyId } },
    include: { userTest: { include: { user: true, test: true } } },
    orderBy: { createdAt: 'desc' }
  });
}

module.exports = { createCompany, getAllCompanies, getCompanyById, updateCompany, deleteCompany, getCompanyUsers, getCompanyReports };