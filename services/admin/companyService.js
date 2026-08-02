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
  const companyId = parseInt(id);

  // Check if company exists first
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    return { message: 'Company not found or already deleted' };
  }

  // 1. Find all user IDs in this company
  const companyUsers = await prisma.user.findMany({
    where: { companyId },
    select: { id: true }
  });
  const userIds = companyUsers.map(u => u.id);

  // 2. Find all UserTest IDs for this company
  const companyUserTests = await prisma.userTest.findMany({
    where: { companyId },
    select: { id: true }
  });
  const userTestIds = companyUserTests.map(ut => ut.id);

  // 3. Find all TestAttempt IDs for these UserTests
  let testAttemptIds = [];
  if (userTestIds.length > 0) {
    const testAttempts = await prisma.testAttempt.findMany({
      where: { userTestId: { in: userTestIds } },
      select: { id: true }
    });
    testAttemptIds = testAttempts.map(ta => ta.id);
  }

  // 4. Find all TeamSolution IDs in this company
  const teamSolutions = await prisma.teamSolution.findMany({
    where: { companyId },
    select: { id: true }
  });
  const solutionIds = teamSolutions.map(ts => ts.id);

  // Delete in correct order (leaf nodes first)

  // Delete GPTMessages (depends on TestAttempt)
  if (testAttemptIds.length > 0) {
    await prisma.gPTMessage.deleteMany({
      where: { testAttemptId: { in: testAttemptIds } }
    });
  }

  // Delete TestAnswers (depends on TestAttempt)
  if (testAttemptIds.length > 0) {
    await prisma.testAnswer.deleteMany({
      where: { testAttemptId: { in: testAttemptIds } }
    });
  }

  // Delete Reports (depends on UserTest)
  if (userTestIds.length > 0) {
    await prisma.report.deleteMany({
      where: { userTestId: { in: userTestIds } }
    });
  }

  // Delete TestAttempts (depends on UserTest)
  if (userTestIds.length > 0) {
    await prisma.testAttempt.deleteMany({
      where: { userTestId: { in: userTestIds } }
    });
  }

  // Delete UserTests
  if (userTestIds.length > 0) {
    await prisma.userTest.deleteMany({
      where: { id: { in: userTestIds } }
    });
  }

  // Delete SolutionLikes (depends on TeamSolution)
  if (solutionIds.length > 0) {
    await prisma.solutionLike.deleteMany({
      where: { solutionId: { in: solutionIds } }
    });
  }

  // Delete TeamSolutions
  await prisma.teamSolution.deleteMany({
    where: { companyId }
  });

  // Delete TeamProblems
  await prisma.teamProblem.deleteMany({
    where: { companyId }
  });

  // Preserve AiUsage: Set companyId to NULL instead of deleting
  // This keeps AI usage stats accurate for the admin dashboard
  await prisma.aiUsage.updateMany({
    where: { companyId },
    data: { companyId: null }
  });

  // Delete CompanyTest assignments
  await prisma.companyTest.deleteMany({
    where: { companyId }
  });

  // Delete Tests created by users in this company or assigned to this company
  await prisma.test.deleteMany({
    where: {
      OR: [
        { companyId },
        { createdById: { in: userIds } }
      ]
    }
  });

  // Delete Users in this company
  await prisma.user.deleteMany({
    where: { companyId }
  });

  // Finally, delete the Company itself
  await prisma.company.deleteMany({
    where: { id: companyId }
  });

  return { message: 'Company and all associated data deleted successfully' };
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