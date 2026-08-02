const { prisma } = require('../../utils/prismaClient');

function prepareUserData(data) {
  const prepared = { ...data };
  if (prepared.dateOfBirth && typeof prepared.dateOfBirth === 'string') {
    prepared.dateOfBirth = new Date(prepared.dateOfBirth + 'T00:00:00.000Z');
  }
  if (prepared.dateOfBirth === '' || prepared.dateOfBirth === null || prepared.dateOfBirth === undefined) {
    delete prepared.dateOfBirth;
  }
  return prepared;
}

async function createUser(data) {
  return prisma.user.create({
    data: { 
      ...prepareUserData(data),
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
    data: prepareUserData(data),
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
    ...prepareUserData(user),
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
