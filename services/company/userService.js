const { prisma } = require('../../utils/prismaClient');
// Remove the hash import since we don't need it

async function createUser(data) {
  return prisma.user.create({
    data: { 
      ...data,
      password: data.password,
      role: data.role || 'USER'
    },
    include: { assignedTests: { include: { test: true } } }
  });
}

async function getCompanyUsers(companyId) {
  return prisma.user.findMany({
    where: { companyId, deletedAt: null },
    include: {
      assignedTests: { 
        include: { test: true, report: true, attempts: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}

async function updateUser(id, data, companyId) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.deletedAt || user.companyId !== companyId) {
    const err = new Error('User not found in company');
    err.status = 404;
    throw err;
  }
  return prisma.user.update({
    where: { id },
    data,
    include: { assignedTests: { include: { test: true } } }
  });
}

async function deleteUser(id, companyId) {
  return prisma.user.update({
    where: { id, companyId },
    data: { deletedAt: new Date() }
  });
}

async function bulkCreateUsers(users, companyId) {
  const usersWithPlainText = users.map((user) => ({
    ...user,
    password: user.password,
    companyId,
    role: user.role || 'USER'
  }));
  
  const result = await prisma.user.createMany({
    data: usersWithPlainText,
    skipDuplicates: true
  });
  
  return { count: result.count };
}

module.exports = { createUser, getCompanyUsers, updateUser, deleteUser, bulkCreateUsers };
