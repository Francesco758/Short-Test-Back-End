// services/company/testService.js
const { prisma } = require('../../utils/prismaClient');
const emailService = require('../emailService');

async function getAssignedTests(companyId) {
  return await prisma.companyTest.findMany({
    where: { companyId },
    include: { 
      test: { 
        include: { 
          _count: { select: { userAssignments: true } }
        } 
      } 
    }
  });
}

async function assignTestToUsers({ testId, userIds, companyId, notify = true, scheduleAt = null, brief = null, deadline = null }) {
  // Verify test is assigned to company and get company name
  const companyTest = await prisma.companyTest.findFirst({
    where: { testId, companyId },
    include: { 
      test: true,
      company: { select: { name: true } }
    }
  });
  
  if (!companyTest) {
    throw new Error('Test not assigned to company');
  }

  // Get users with their details for email (INCLUDE PASSWORD)
  const users = await prisma.user.findMany({
    where: { 
      id: { in: userIds },
      companyId 
    },
    select: {
      id: true,
      email: true,
      name: true,
      password: true // ✅ Include the actual password
    }
  });

  if (users.length !== userIds.length) {
    throw new Error('Some users not found in company');
  }

  // Create user test assignments for all selected users.
  // We now allow multiple assignments of the same test to the same user.
  const userTestsData = userIds.map(userId => ({
    userId,
    testId,
    companyId,
    assignedAt: scheduleAt ? new Date(scheduleAt) : new Date(),
    brief: companyTest.test.isCustom ? (brief || null) : null,
    deadline: deadline ? new Date(deadline) : null,
    source: 'manager'
  }));
  
  const result = await prisma.userTest.createMany({
    data: userTestsData
  });

  // Send email notifications if requested - WITH COMPANY CONTEXT
  if (notify && users.length > 0) {
    await sendAssignmentEmails(users, [companyTest.test], companyTest.company.name);
  }

  return {
    ...result,
    assignedUsers: users.map(u => ({ id: u.id, email: u.email, name: u.name })),
    test: companyTest.test
  };
}

async function bulkAssignTests({ testIds, userIds, companyId, notify = true, scheduleAt = null, deadline = null }) {
  // Verify all tests are assigned to company and get company name
  const companyTests = await prisma.companyTest.findMany({
    where: { testId: { in: testIds }, companyId },
    include: { 
      test: true,
      company: { select: { name: true } }
    }
  });
  
  if (companyTests.length !== testIds.length) {
    throw new Error('Some tests are not assigned to company');
  }

  // Get users with their details for email (INCLUDE PASSWORD)
  const users = await prisma.user.findMany({
    where: { 
      id: { in: userIds },
      companyId 
    },
    select: {
      id: true,
      email: true,
      name: true,
      password: true // ✅ Include the actual password
    }
  });

  if (users.length !== userIds.length) {
    throw new Error('Some users not found in company');
  }

  // Create all user test assignments.
  // We now allow multiple assignments of the same test to the same user.
  const userTestsData = [];

  for (const testId of testIds) {
    for (const userId of userIds) {
      userTestsData.push({ 
        userId, 
        testId, 
        companyId,
        assignedAt: scheduleAt ? new Date(scheduleAt) : new Date(),
        deadline: deadline ? new Date(deadline) : null,
        source: 'manager'
      });
    }
  }
  
  const result = await prisma.userTest.createMany({
    data: userTestsData
  });

  // Send email notifications if requested - WITH COMPANY CONTEXT
  if (notify) {
    if (users.length > 0) {
      const tests = companyTests.map(ct => ct.test);
      const companyName = companyTests[0].company.name;
      await sendBulkAssignmentEmails(users, tests, companyName);
    }
  }

  return {
    ...result,
    assignedUsers: users.map(u => ({ id: u.id, email: u.email, name: u.name })),
    tests: companyTests.map(ct => ct.test)
  };
}

async function sendAssignmentEmails(users, tests, companyName) {
  const loginUrl = `${process.env.FRONTEND_URL}/login`;
  
  for (const user of users) {
    try {
      // ✅ Send the user's actual password from database
      if (tests.length === 1) {
        await emailService.sendTestAssignmentEmail(user, tests[0], companyName, loginUrl, user.password);
      } else {
        await emailService.sendBulkTestAssignmentEmail(user, tests, companyName, loginUrl, user.password);
      }
      
      console.log(`✅ Assignment email sent to ${user.email} from company ${companyName}`);
    } catch (error) {
      console.error(`❌ Failed to send assignment email to ${user.email}:`, error);
      // Don't throw - continue with other users
    }
  }
}

async function sendBulkAssignmentEmails(users, tests, companyName) {
  const loginUrl = `${process.env.FRONTEND_URL}/login`;
  
  for (const user of users) {
    try {
      // ✅ Send the user's actual password from database
      await emailService.sendBulkTestAssignmentEmail(user, tests, companyName, loginUrl, user.password);
      console.log(`✅ Bulk assignment email sent to ${user.email} from company ${companyName}`);
    } catch (error) {
      console.error(`❌ Failed to send bulk assignment email to ${user.email}:`, error);
    }
  }
}

async function getGuestAccessCompanies() {
  const companies = await prisma.company.findMany({
    where: { guestMode: true, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  });

  return companies;
}

/**
 * Guest mode is a company-level switch (Company.guestMode), independent of any
 * test. Turning it ON only lets people log in as guests; guests then start any
 * active company shorTest from their own "Start a shorTest" flow, exactly like
 * a regular user. Turning it OFF also revokes their in-flight work (see below).
 */
async function getCompanyGuestAccess(companyId) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, guestMode: true }
  });
  return { active: company?.guestMode === true };
}

async function setCompanyGuestAccess(companyId, enabled) {
  const company = await prisma.company.update({
    where: { id: companyId },
    data: { guestMode: enabled === true },
    select: { id: true, name: true, guestMode: true }
  });
  return { active: company.guestMode === true };
}

/**
 * Turn guest mode off for the company.
 * - Company.guestMode goes false, so the public guest-companies list stops
 *   offering the company on the login page and new guest logins are rejected.
 * - Untouched guest assignments (ASSIGNED, never started, no attempt/report)
 *   are deleted: those are empty placeholders.
 * - Started-but-unfinished guest assignments (IN_PROGRESS) keep all their
 *   attempt/conversation data and are only marked EXPIRED, which removes them
 *   from every list query (all of them filter on explicit status sets).
 * - COMPLETED guest tests and their reports are never touched.
 */
async function deactivateGuestMode(companyId) {
  return prisma.$transaction(async (tx) => {
    await tx.company.update({
      where: { id: companyId },
      data: { guestMode: false }
    });

    const result = {
      removedAssignments: 0,
      expiredAssignments: 0,
      keptCompleted: 0
    };

    const removed = await tx.userTest.deleteMany({
      where: {
        companyId,
        status: 'ASSIGNED',
        startedAt: null,
        completedAt: null,
        user: { isGuest: true },
        attempts: { none: {} },
        report: null
      }
    });
    result.removedAssignments = removed.count;

    const expired = await tx.userTest.updateMany({
      where: {
        companyId,
        status: 'IN_PROGRESS',
        completedAt: null,
        user: { isGuest: true }
      },
      data: { status: 'EXPIRED' }
    });
    result.expiredAssignments = expired.count;

    result.keptCompleted = await tx.userTest.count({
      where: { companyId, status: 'COMPLETED', user: { isGuest: true } }
    });

    return result;
  });
}

module.exports = { 
  getAssignedTests, 
  assignTestToUsers, 
  bulkAssignTests,
  getGuestAccessCompanies,
  getCompanyGuestAccess,
  setCompanyGuestAccess,
  deactivateGuestMode
};
