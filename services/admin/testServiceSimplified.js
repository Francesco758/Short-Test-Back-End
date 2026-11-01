const { prisma } = require('../../utils/prismaClient');
const { ValidationError, NotFoundError } = require('../../utils/errors');

/**
 * Simplified Test Service
 * - Single system prompt per test
 * - No complex phase structure
 * - Easy test creation
 */

async function createTest(data) {
  const { title, description, systemPrompt, status = 'DRAFT', createdById } = data;
  
  if (!title || !systemPrompt) {
    throw new Error('Title and system prompt are required');
  }

  if (systemPrompt.trim().length < 50) {
    throw new Error('System prompt must be at least 50 characters long');
  }

  // Create test with single system prompt
  const test = await prisma.test.create({
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      systemPrompt: systemPrompt.trim(),
      status,
      createdById,
      settings: {} // Empty settings for now
    },
    include: {
      createdBy: {
        select: { id: true, name: true, email: true }
      }
    }
  });

  return test;
}

async function getAllTests({ page = 1, limit = 10, status, search }) {
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const where = { deletedAt: null };
  
  if (status) {
    where.status = status;
  }
  
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } }
    ];
  }
  
  const [tests, total] = await Promise.all([
    prisma.test.findMany({
      where,
      skip,
      take: parseInt(limit),
      include: { 
        createdBy: {
          select: { id: true, name: true, email: true }
        },
        _count: {
          select: {
            companyAssignments: true,
            userAssignments: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.test.count({ where })
  ]);
  
  return { 
    tests, 
    total, 
    page: parseInt(page), 
    limit: parseInt(limit),
    totalPages: Math.ceil(total / parseInt(limit))
  };
}

async function getTestById(id) {
  const test = await prisma.test.findUnique({
    where: { id: parseInt(id), deletedAt: null },
    include: { 
      createdBy: {
        select: { id: true, name: true, email: true }
      },
      companyAssignments: {
        include: { 
          company: {
            select: { id: true, name: true }
          }
        }
      },
      _count: {
        select: {
          userAssignments: true,
          testAttempts: true
        }
      }
    }
  });

  if (!test) {
    throw new Error('Test not found');
  }

  return test;
}

async function updateTest(id, data) {
  const { title, description, systemPrompt, status, settings } = data;
  
  const updateData = {};
  
  if (title) updateData.title = title.trim();
  if (description !== undefined) updateData.description = description?.trim() || null;
  if (systemPrompt) {
    if (systemPrompt.trim().length < 50) {
      throw new Error('System prompt must be at least 50 characters long');
    }
    updateData.systemPrompt = systemPrompt.trim();
  }
  if (status) updateData.status = status;
  if (settings) updateData.settings = settings;

  const test = await prisma.test.update({
    where: { id: parseInt(id), deletedAt: null }, 
    data: updateData,
    include: {
      createdBy: {
        select: { id: true, name: true, email: true }
      },
      _count: {
        select: {
          companyAssignments: true,
          userAssignments: true
        }
      }
    }
  });

  return test;
}

async function deleteTest(id) {
  // Soft delete
  const test = await prisma.test.update({ 
    where: { id: parseInt(id) }, 
    data: { deletedAt: new Date() },
    include: {
      _count: {
        select: {
          userAssignments: true
        }
      }
    }
  });

  return {
    message: 'Test deleted successfully',
    deletedTest: test
  };
}

async function assignTestToCompany({ testId, companyId, assignedById }) {
  // Check if test exists
  const test = await prisma.test.findUnique({
    where: { id: parseInt(testId), deletedAt: null }
  });

  if (!test) {
    throw new Error('Test not found');
  }

  // Check if company exists
  const company = await prisma.company.findUnique({
    where: { id: parseInt(companyId), deletedAt: null }
  });

  if (!company) {
    throw new Error('Company not found');
  }

  // Check if already assigned
  const existing = await prisma.companyTest.findUnique({
    where: {
      companyId_testId: {
        companyId: parseInt(companyId),
        testId: parseInt(testId)
      }
    }
  });

  if (existing) {
    throw new Error('Test already assigned to this company');
  }

  // Create company assignment
  const assignment = await prisma.companyTest.create({
    data: { 
      testId: parseInt(testId), 
      companyId: parseInt(companyId), 
      assignedById: parseInt(assignedById) 
    },
    include: { 
      test: {
        select: { id: true, title: true, status: true }
      }, 
      company: {
        select: { id: true, name: true }
      },
      assignedBy: {
        select: { id: true, name: true, email: true }
      }
    }
  });

  // Create UserTest for all users in the company
  const companyUsers = await prisma.user.findMany({
    where: { 
      companyId: parseInt(companyId),
      deletedAt: null,
      role: 'USER' // Only assign to regular users
    }
  });

  if (companyUsers.length > 0) {
    // We now allow multiple assignments of the same test to the same user.
    // Each assignment will be treated as a new, independent test instance.
    await prisma.userTest.createMany({
      data: companyUsers.map(user => ({
        userId: user.id,
        testId: parseInt(testId),
        companyId: parseInt(companyId),
        status: 'ASSIGNED',
        source: 'manager'
      }))
    });
  }

  return {
    assignment,
    usersAssigned: companyUsers.length,
    message: `Test assigned to ${company.name} (${companyUsers.length} users)`
  };
}

/**
 * Remove a test assignment from a company.
 *
 * Data-safe by design:
 * - Deletes the company-level assignment (CompanyTest).
 * - Deletes only the user assignments that were never started (status 'ASSIGNED'),
 *   so those cards disappear from employees' dashboards.
 * - Everything that is IN_PROGRESS or COMPLETED is intentionally kept, together
 *   with all its attempts, chat messages and reports. Nothing is hard-deleted and
 *   the Test record itself is untouched.
 *
 * Both deletes run in a single transaction so the assignment can never end up
 * removed without its pending cards.
 */
async function unassignTestFromCompany({ testId, companyId }) {
  const tid = parseInt(testId, 10);
  const cid = parseInt(companyId, 10);

  if (Number.isNaN(tid) || Number.isNaN(cid)) {
    throw new ValidationError('testId and companyId must be numbers');
  }

  const existing = await prisma.companyTest.findUnique({
    where: {
      companyId_testId: {
        companyId: cid,
        testId: tid
      }
    }
  });

  if (!existing) {
    throw new NotFoundError('Test is not assigned to this company');
  }

  const [, removedUserTests] = await prisma.$transaction([
    prisma.companyTest.delete({ where: { id: existing.id } }),
    prisma.userTest.deleteMany({
      where: {
        companyId: cid,
        testId: tid,
        status: 'ASSIGNED'
      }
    })
  ]);

  return {
    message: 'Test unassigned from company',
    removedAssignments: removedUserTests.count
  };
}

async function bulkAssignTests({ testIds, companyIds, assignedById }) {
  const results = {
    successful: 0,
    failed: 0,
    errors: []
  };

  for (const testId of testIds) {
    for (const companyId of companyIds) {
      try {
        await assignTestToCompany({ 
          testId: parseInt(testId), 
          companyId: parseInt(companyId), 
          assignedById: parseInt(assignedById) 
        });
        results.successful++;
      } catch (err) {
        results.failed++;
        results.errors.push({
          testId,
          companyId,
          error: err.message
        });
      }
    }
  }

  return {
    ...results,
    totalAttempted: testIds.length * companyIds.length,
    message: `Bulk assignment completed: ${results.successful} successful, ${results.failed} failed`
  };
}

async function getCustomTest() {
  return prisma.test.findFirst({
    where: { isCustom: true, deletedAt: null },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      _count: { select: { companyAssignments: true, userAssignments: true } }
    }
  });
}

async function createCustomTest(data) {
  const existing = await prisma.test.findFirst({ where: { isCustom: true, deletedAt: null } });
  if (existing) {
    throw new Error('Custom test already exists. Delete it before creating a new one.');
  }
  const { title, description, systemPrompt, createdById } = data;
  if (!title || !systemPrompt) {
    throw new Error('Title and system prompt are required');
  }
  if (systemPrompt.trim().length < 50) {
    throw new Error('System prompt must be at least 50 characters long');
  }
  return prisma.test.create({
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      systemPrompt: systemPrompt.trim(),
      status: 'ACTIVE',
      isCustom: true,
      createdById,
      settings: {}
    },
    include: {
      createdBy: { select: { id: true, name: true, email: true } }
    }
  });
}

async function updateCustomTest(data) {
  const existing = await prisma.test.findFirst({ where: { isCustom: true, deletedAt: null } });
  if (!existing) {
    throw new Error('Custom test not found');
  }
  const updateData = {};
  if (data.title) updateData.title = data.title.trim();
  if (data.description !== undefined) updateData.description = data.description?.trim() || null;
  if (data.systemPrompt) {
    if (data.systemPrompt.trim().length < 50) {
      throw new Error('System prompt must be at least 50 characters long');
    }
    updateData.systemPrompt = data.systemPrompt.trim();
  }
  if (data.status) updateData.status = data.status;
  if (data.settings) updateData.settings = data.settings;
  return prisma.test.update({
    where: { id: existing.id },
    data: updateData,
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      _count: { select: { companyAssignments: true, userAssignments: true } }
    }
  });
}

async function deleteCustomTest() {
  const existing = await prisma.test.findFirst({ where: { isCustom: true, deletedAt: null } });
  if (!existing) {
    throw new Error('Custom test not found');
  }
  await prisma.test.update({
    where: { id: existing.id },
    data: { deletedAt: new Date() }
  });
  return true;
}

module.exports = {
  createTest,
  getAllTests,
  getTestById,
  updateTest,
  deleteTest,
  assignTestToCompany,
  unassignTestFromCompany,
  bulkAssignTests,
  getCustomTest,
  createCustomTest,
  updateCustomTest,
  deleteCustomTest
};
