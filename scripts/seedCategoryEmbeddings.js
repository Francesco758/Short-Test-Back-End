const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { generateEmbedding } = require('../services/embeddingService');

async function seedAll() {
  console.log('Fetching all companies with active data...');
  const companies = await prisma.company.findMany({ where: { deletedAt: null } });
  console.log(`Found ${companies.length} companies.`);

  for (const company of companies) {
    console.log(`\n--- Company: ${company.name} (ID: ${company.id}) ---`);

    const reports = await prisma.report.findMany({
      where: { userTest: { companyId: company.id } },
      select: { id: true, detailedAnalysis: true }
    });

    const candidates = [];

    for (const r of reports) {
      const da = r.detailedAnalysis || {};
      const pKey = da.problem_key;
      const pSummary = da.problem_summary;
      const pTopic = da.problem_topic || da.problem_cluster;
      if (pKey && pSummary && typeof pSummary === 'string' && pSummary.length > 10) {
        candidates.push({ reportId: r.id, key: pKey, topic: pTopic || pKey, type: 'problem', summary: pSummary });
      }
      const sKey = da.solution_key;
      const sSummary = da.solution_summary;
      const sTopic = da.solution_topic || da.solution_cluster;
      if (sKey && sSummary && typeof sSummary === 'string' && sSummary.length > 10) {
        candidates.push({ reportId: r.id, key: sKey, topic: sTopic || sKey, type: 'solution', summary: sSummary });
      }
    }

    if (!candidates.length) {
      console.log('No reports with problem/solution summaries found, skipping.');
      continue;
    }

    const existing = await prisma.reportEmbedding.findMany({
      where: { companyId: company.id },
      select: { reportId: true, type: true }
    });
    const existingSet = new Set(existing.map(e => `${e.reportId}:${e.type}`));
    const missing = candidates.filter(c => !existingSet.has(`${c.reportId}:${c.type}`));

    if (!missing.length) {
      console.log(`All ${candidates.length} report summaries already embedded.`);
      continue;
    }

    console.log(`Generating embeddings for ${missing.length} individual report summaries (${reports.length} reports found)...`);

    const batchSize = 20;
    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      const texts = batch.map(item => item.summary);

      try {
        const embeddings = await Promise.all(texts.map(t => generateEmbedding(t)));

        await prisma.reportEmbedding.createMany({
          data: batch.map((item, idx) => ({
            companyId: company.id,
            reportId: item.reportId,
            key: item.key,
            type: item.type,
            topic: item.topic,
            summary: item.summary,
            embedding: JSON.stringify(embeddings[idx])
          })),
          skipDuplicates: true
        });

        console.log(`  Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(missing.length / batchSize)} done (${batch.length} items).`);
      } catch (err) {
        console.error(`  Batch failed: ${err.message}`);
      }
    }

    console.log(`Done for ${company.name}.`);
  }

  console.log('\nAll companies seeded successfully.');
  await prisma.$disconnect();
}

seedAll().catch(err => {
  console.error('Fatal error:', err);
  prisma.$disconnect();
  process.exit(1);
});
