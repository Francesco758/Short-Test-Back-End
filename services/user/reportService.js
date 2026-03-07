const { prisma } = require('../../utils/prismaClient');

const TRANSLATIONS = {
  en: {
    simplification: 'Simplification',
    originality: 'Originality',
    feasibility: 'Feasibility',
    criticalThinking: 'Critical Thinking',
    proactivity: 'Proactivity',
    assessmentSingular: 'assessment',
    assessmentPlural: 'assessments',
    summaryTemplate: (count, assessmentText, score, strength, strengthScore, weakness, weaknessScore) => 
      `Based on your performance across ${count} ${assessmentText}, your average overall score is ${score}%. You demonstrate consistent strength in ${strength} (${strengthScore}%), while ${weakness} (${weaknessScore}%) represents a key area for continued development.`
  },
  it: {
    simplification: 'Semplificazione',
    originality: 'Originalità',
    feasibility: 'Fattibilità',
    criticalThinking: 'Pensiero Critico',
    proactivity: 'Proattività',
    assessmentSingular: 'valutazione',
    assessmentPlural: 'valutazioni',
    summaryTemplate: (count, assessmentText, score, strength, strengthScore, weakness, weaknessScore) => 
      `Basandosi sulla tua performance in ${count} ${assessmentText}, il tuo punteggio medio complessivo è ${score}%. Dimostri una forza costante in ${strength} (${strengthScore}%), mentre ${weakness} (${weaknessScore}%) rappresenta un'area chiave per un ulteriore sviluppo.`
  },
  fr: {
    simplification: 'Simplification',
    originality: 'Originalité',
    feasibility: 'Faisabilité',
    criticalThinking: 'Esprit Critique',
    proactivity: 'Proactivité',
    assessmentSingular: 'évaluation',
    assessmentPlural: 'évaluations',
    summaryTemplate: (count, assessmentText, score, strength, strengthScore, weakness, weaknessScore) => 
      `Sur la base de vos performances dans ${count} ${assessmentText}, votre score global moyen est de ${score}%. Vous faites preuve d'une force constante en ${strength} (${strengthScore}%), tandis que ${weakness} (${weaknessScore}%) représente un domaine clé à développer.`
  },
  es: {
    simplification: 'Simplificación',
    originality: 'Originalidad',
    feasibility: 'Factibilidad',
    criticalThinking: 'Pensamiento Crítico',
    proactivity: 'Proactividad',
    assessmentSingular: 'evaluación',
    assessmentPlural: 'evaluaciones',
    summaryTemplate: (count, assessmentText, score, strength, strengthScore, weakness, weaknessScore) => 
      `Basado en tu desempeño en ${count} ${assessmentText}, tu puntaje general promedio es ${score}%. Demuestras una fortaleza constante en ${strength} (${strengthScore}%), mientras que ${weakness} (${weaknessScore}%) representa un área clave para el desarrollo continuo.`
  },
  de: {
    simplification: 'Vereinfachung',
    originality: 'Originalität',
    feasibility: 'Machbarkeit',
    criticalThinking: 'Kritisches Denken',
    proactivity: 'Proaktivität',
    assessmentSingular: 'Bewertung',
    assessmentPlural: 'Bewertungen',
    summaryTemplate: (count, assessmentText, score, strength, strengthScore, weakness, weaknessScore) => 
      `Basierend auf Ihrer Leistung in ${count} ${assessmentText} beträgt Ihre durchschnittliche Gesamtpunktzahl ${score}%. Sie zeigen beständige Stärke in ${strength} (${strengthScore}%), während ${weakness} (${weaknessScore}%) einen Schlüsselbereich für die weitere Entwicklung darstellt.`
  }
};

/**
 * Get CKPI metrics with component-level trends for a specific user
 */
async function getUserCKPIMetrics(userId) {
  const now = new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  // Get all reports for this user
  const allReports = await prisma.report.findMany({
    where: { 
      userTest: { userId, status: 'COMPLETED' }
    },
    include: {
      userTest: {
        include: {
          test: {
            select: { settings: true }
          }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  if (!allReports.length) {
    return {
      userAverages: { simplification: 0, originality: 0, feasibility: 0, criticalThinking: 0, proactivity: 0 },
      componentTrends: { simplification: 0, originality: 0, feasibility: 0, criticalThinking: 0, proactivity: 0 },
      totalReports: 0,
      trend: 0,
      lastUpdated: new Date().toLocaleString()
    };
  }

  // Current month reports
  const currentMonthReports = allReports.filter(r => new Date(r.createdAt) >= currentMonth);
  // Last month reports
  const lastMonthReports = allReports.filter(r => 
    new Date(r.createdAt) >= lastMonth && new Date(r.createdAt) < currentMonth
  );

  // Helper to calculate component averages
  const getComponentAverages = (reports) => {
    if (!reports.length) return { simplification: 0, originality: 0, feasibility: 0, criticalThinking: 0, proactivity: 0 };
    const sums = reports.reduce((acc, r) => {
      const comps = r.kpis?.components || {};
      acc.simplification += comps.simplification || 0;
      acc.originality += comps.originality || 0;
      acc.feasibility += comps.feasibility || 0;
      acc.criticalThinking += comps.criticalThinking || 0;
      acc.proactivity += comps.proactivity || 0;
      return acc;
    }, { simplification: 0, originality: 0, feasibility: 0, criticalThinking: 0, proactivity: 0 });
    
    return {
      simplification: Math.round(sums.simplification / reports.length),
      originality: Math.round(sums.originality / reports.length),
      feasibility: Math.round(sums.feasibility / reports.length),
      criticalThinking: Math.round(sums.criticalThinking / reports.length),
      proactivity: Math.round(sums.proactivity / reports.length)
    };
  };

  const userComps = getComponentAverages(allReports);
  const currentComps = getComponentAverages(currentMonthReports);
  const lastComps = getComponentAverages(lastMonthReports);

  // Calculate component-level trends
  const componentTrends = {};
  Object.keys(userComps).forEach(key => {
    const currentVal = currentComps[key];
    const lastVal = lastComps[key];
    
    if (lastVal > 0) {
      componentTrends[key] = Math.round(((currentVal - lastVal) / lastVal) * 100);
    } else if (currentVal > 0) {
      componentTrends[key] = 100; // 100% improvement if there was no value before
    } else {
      componentTrends[key] = 0;
    }
  });

  // Calculate overall trend
  const currentAvg = currentMonthReports.length > 0 
    ? currentMonthReports.reduce((sum, r) => sum + (r.kpis?.final || 0), 0) / currentMonthReports.length
    : 0;
  const lastAvg = lastMonthReports.length > 0
    ? lastMonthReports.reduce((sum, r) => sum + (r.kpis?.final || 0), 0) / lastMonthReports.length
    : 0;

  const trend = lastAvg > 0 ? Math.round(((currentAvg - lastAvg) / lastAvg) * 100) : 0;

  // Generate summary based on averages across all reports
  const overallScore = Math.round(
    Object.values(userComps).reduce((a, b) => a + b, 0) / 5
  );

  // Determine language from the most recent test (or default to 'en')
  const latestReport = allReports[0];
  const settings = latestReport?.userTest?.test?.settings;
  const language = (settings?.language || 'en').toLowerCase();
  const t = TRANSLATIONS[language] || TRANSLATIONS['en'];

  // Helper to format component names
  const formatComp = (key) => {
    return t[key] || key;
  };

  // Find strongest and weakest areas
  const entries = Object.entries(userComps);
  entries.sort((a, b) => b[1] - a[1]); // Sort by score descending
  
  const strongest = entries[0];
  const weakest = entries[entries.length - 1];

  const assessmentText = allReports.length === 1 ? t.assessmentSingular : t.assessmentPlural;
  const summary = t.summaryTemplate(
    allReports.length,
    assessmentText,
    overallScore,
    formatComp(strongest[0]),
    strongest[1],
    formatComp(weakest[0]),
    weakest[1]
  );

  // Aggregate strengths and improvements from recent reports (top 5)
  // to give a representative overview
  const recentReports = allReports.slice(0, 5);
  
  const aggregateList = (reports, key) => {
    const allItems = reports.flatMap(r => r.kpis?.[key] || []);
    if (allItems.length === 0) return [];
    
    // Count occurrences
    const counts = allItems.reduce((acc, item) => {
      acc[item] = (acc[item] || 0) + 1;
      return acc;
    }, {});
    
    // Sort by frequency and take top 3
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([item]) => item)
      .slice(0, 3);
  };

  const strengths = aggregateList(recentReports, 'strengths');
  const improvements = aggregateList(recentReports, 'improvements');

  return {
    averages: userComps,
    componentTrends,
    totalReports: allReports.length,
    trend,
    lastUpdated: new Date().toLocaleString(),
    strengths,
    improvements,
    summary
  };
}

module.exports = { getUserCKPIMetrics };