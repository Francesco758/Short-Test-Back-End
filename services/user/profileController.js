const { prisma } = require('../../utils/prismaClient');
const { hash, compare } = require('../../utils/hash');

async function getProfile(userId) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      company: true,
      createdAt: true,
      lastLoginAt: true
    }
  });
}

async function updateProfile(userId, data) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      name: data.name,
      email: data.email
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      company: true
    }
  });
}

async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  
  if (!await compare(currentPassword, user.password)) {
    throw new Error('Current password is incorrect');
  }
  
  const hashedPassword = await hash(newPassword);
  
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword }
  });
  
  return { message: 'Password updated successfully' };
}

module.exports = { getProfile, updateProfile, changePassword };