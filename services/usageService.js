const { prisma } = require('../utils/prismaClient');

const MODEL_PRICING = {
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60 },
  'gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00 },
  'gpt-4': { inputPer1M: 30.00, outputPer1M: 60.00 },
  'gpt-image-1': { perImage: 0.040 },
  'gpt-svg': { inputPer1M: 0.15, outputPer1M: 0.60 },
};

function calculateCost(model, promptTokens, completionTokens) {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  if (pricing.perImage != null) return pricing.perImage;
  const inputCost = (promptTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (completionTokens / 1_000_000) * pricing.outputPer1M;
  return parseFloat((inputCost + outputCost).toFixed(6));
}

async function recordUsage({ userId, companyId, source, model, promptTokens, completionTokens, totalTokens, endpoint }) {
  try {
    const estimatedCostUsd = calculateCost(model, promptTokens, completionTokens) || 0;
    return await prisma.aiUsage.create({
      data: {
        userId: userId || null,
        companyId: companyId || null,
        source,
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd,
        metadata: endpoint ? { endpoint } : undefined,
      }
    });
  } catch (err) {
    console.error('[UsageService] Failed to record usage:', err.message);
    return null;
  }
}

async function getUsageSummary({ startDate, endDate } = {}) {
  const where = {};
  if (startDate) where.createdAt = { ...where.createdAt, gte: new Date(startDate) };
  if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate) };

  const [aggregate, count] = await Promise.all([
    prisma.aiUsage.aggregate({
      where,
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true, estimatedCostUsd: true },
    }),
    prisma.aiUsage.count({ where }),
  ]);

  return {
    totalTokens: aggregate._sum.totalTokens || 0,
    promptTokens: aggregate._sum.promptTokens || 0,
    completionTokens: aggregate._sum.completionTokens || 0,
    totalCost: parseFloat((aggregate._sum.estimatedCostUsd || 0).toFixed(4)),
    totalRequests: count,
  };
}

async function getUsageByCompany({ startDate, endDate } = {}) {
  const where = {};
  if (startDate) where.createdAt = { ...where.createdAt, gte: new Date(startDate) };
  if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate) };

  const records = await prisma.aiUsage.groupBy({
    by: ['companyId'],
    where: { ...where, companyId: { not: null } },
    _sum: { promptTokens: true, completionTokens: true, totalTokens: true, estimatedCostUsd: true },
    _count: true,
  });

  const companyIds = records.map(r => r.companyId).filter(Boolean);
  const companies = companyIds.length > 0
    ? await prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
    : [];
  const companyMap = Object.fromEntries(companies.map(c => [c.id, c.name]));

  return records.map(r => ({
    companyId: r.companyId,
    companyName: companyMap[r.companyId] || 'Unknown',
    totalTokens: r._sum.totalTokens || 0,
    promptTokens: r._sum.promptTokens || 0,
    completionTokens: r._sum.completionTokens || 0,
    totalCost: parseFloat((r._sum.estimatedCostUsd || 0).toFixed(4)),
    totalRequests: r._count,
  })).sort((a, b) => b.totalTokens - a.totalTokens);
}

async function getUsageByUser({ startDate, endDate, companyId } = {}) {
  const where = {};
  if (startDate) where.createdAt = { ...where.createdAt, gte: new Date(startDate) };
  if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate) };
  if (companyId) where.companyId = companyId;

  const records = await prisma.aiUsage.groupBy({
    by: ['userId'],
    where: { ...where, userId: { not: null } },
    _sum: { promptTokens: true, completionTokens: true, totalTokens: true, estimatedCostUsd: true },
    _count: true,
  });

  const userIds = records.map(r => r.userId).filter(Boolean);
  const users = userIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true, companyId: true } })
    : [];
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));

  const companyIds = users.map(u => u.companyId).filter(Boolean);
  const companies = companyIds.length > 0
    ? await prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
    : [];
  const companyMap = Object.fromEntries(companies.map(c => [c.id, c.name]));

  return records.map(r => {
    const user = userMap[r.userId];
    return {
      userId: r.userId,
      userName: user?.name || 'Unknown',
      userEmail: user?.email || '',
      companyName: user ? companyMap[user.companyId] || '' : '',
      totalTokens: r._sum.totalTokens || 0,
      promptTokens: r._sum.promptTokens || 0,
      completionTokens: r._sum.completionTokens || 0,
      totalCost: parseFloat((r._sum.estimatedCostUsd || 0).toFixed(4)),
      totalRequests: r._count,
    };
  }).sort((a, b) => b.totalTokens - a.totalTokens);
}

async function getUsageBySource({ startDate, endDate } = {}) {
  const where = {};
  if (startDate) where.createdAt = { ...where.createdAt, gte: new Date(startDate) };
  if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate) };

  const records = await prisma.aiUsage.groupBy({
    by: ['source'],
    where,
    _sum: { promptTokens: true, completionTokens: true, totalTokens: true, estimatedCostUsd: true },
    _count: true,
  });

  return records.map(r => ({
    source: r.source,
    totalTokens: r._sum.totalTokens || 0,
    promptTokens: r._sum.promptTokens || 0,
    completionTokens: r._sum.completionTokens || 0,
    totalCost: parseFloat((r._sum.estimatedCostUsd || 0).toFixed(4)),
    totalRequests: r._count,
  })).sort((a, b) => b.totalTokens - a.totalTokens);
}

async function getUsageTrends({ startDate, endDate, granularity = 'day' } = {}) {
  const where = {};
  if (startDate) where.createdAt = { ...where.createdAt, gte: new Date(startDate) };
  if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate) };

  const records = await prisma.aiUsage.findMany({
    where,
    select: { createdAt: true, totalTokens: true, estimatedCostUsd: true, model: true },
    orderBy: { createdAt: 'asc' },
  });

  const grouped = {};
  for (const r of records) {
    let key;
    const d = new Date(r.createdAt);
    if (granularity === 'day') key = d.toISOString().slice(0, 10);
    else if (granularity === 'month') key = d.toISOString().slice(0, 7);
    else key = d.toISOString().slice(0, 10);

    if (!grouped[key]) grouped[key] = { date: key, totalTokens: 0, totalCost: 0, requestCount: 0 };
    grouped[key].totalTokens += r.totalTokens;
    grouped[key].totalCost += r.estimatedCostUsd;
    grouped[key].requestCount += 1;
  }

  return Object.values(grouped).map(g => ({
    ...g,
    totalCost: parseFloat(g.totalCost.toFixed(4)),
  }));
}

module.exports = {
  recordUsage,
  getUsageSummary,
  getUsageByCompany,
  getUsageByUser,
  getUsageBySource,
  getUsageTrends,
};