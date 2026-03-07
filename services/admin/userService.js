const { prisma } = require('../../utils/prismaClient');
const { hash } = require('../../utils/hash');

async function createUser(data) {
  const hashedPassword = await hash(data.password);
  return prisma.user.create({
    data: { ...data, password: hashedPassword },
    include: { company: true }
  });
}

async function getAllUsers({ page, limit, role, companyId, search }) {
  const skip = (page - 1) * limit;
  const where = { deletedAt: null };
  if (role) where.role = role;
  if (companyId) where.companyId = parseInt(companyId);
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } }
    ];
  }
  
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      include: { 
        company: true,
        assignedTests: { include: { test: true, report: true } }
      },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.user.count({ where })
  ]);
  
  return { users, total, page, limit };
}

async function getUserById(id) {
  return prisma.user.findUnique({
    where: { id, deletedAt: null },
    include: { 
      company: true,
      assignedTests: { 
        include: { test: true, report: true, attempts: true } 
      }
    }
  });
}

async function updateUser(id, data) {
  if (data.password) {
    data.password = await hash(data.password);
  }
  return prisma.user.update({
    where: { id, deletedAt: null },
    data,
    include: { company: true }
  });
}

async function deleteUser(id) {
  return prisma.user.update({ 
    where: { id }, 
    data: { deletedAt: new Date() } 
  });
}

async function bulkCreateUsers(users) {
  const usersWithHash = await Promise.all(
    users.map(async (user) => ({
      ...user,
      password: await hash(user.password)
    }))
  );
  
  const result = await prisma.user.createMany({
    data: usersWithHash,
    skipDuplicates: true
  });
  
  return { count: result.count };
}

module.exports = { createUser, getAllUsers, getUserById, updateUser, deleteUser, bulkCreateUsers };