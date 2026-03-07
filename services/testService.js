// KEEP THIS FILE - needed for user test operations
const { prisma } = require('../utils/prismaClient');

// Minimal service for user test operations
async function getUserTest(userTestId, userId) {
  return prisma.userTest.findFirst({
    where: { 
      id: parseInt(userTestId),
      userId: userId
    },
    include: { test: true }
  });
}

module.exports = {
  getUserTest
};