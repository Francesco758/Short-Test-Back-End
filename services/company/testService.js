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
    deadline: deadline ? new Date(deadline) : null
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
        deadline: deadline ? new Date(deadline) : null
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

async function setGuestAccess({ testId, companyId, enabled }) {
  const companyTest = await prisma.companyTest.findFirst({
    where: { testId, companyId }
  });

  if (!companyTest) {
    throw new Error('Test not assigned to company');
  }

  const updated = await prisma.companyTest.update({
    where: { id: companyTest.id },
    data: { guestAccess: enabled },
    include: { test: true }
  });

  return updated;
}

async function getGuestAccessCompanies() {
  const companyTests = await prisma.companyTest.findMany({
    where: { guestAccess: true },
    include: {
      company: { select: { id: true, name: true } },
      test: { select: { id: true, title: true } }
    },
    distinct: ['companyId']
  });

  // Deduplicate by company
  const seen = new Set();
  const companies = [];
  for (const ct of companyTests) {
    if (!seen.has(ct.company.id)) {
      seen.add(ct.company.id);
      companies.push({
        id: ct.company.id,
        name: ct.company.name
      });
    }
  }

  return companies;
}

module.exports = { 
  getAssignedTests, 
  assignTestToUsers, 
  bulkAssignTests,
  setGuestAccess,
  getGuestAccessCompanies
};
