function formatResponse(data, message = 'Success', status = 200) {
  return {
    status,
    message,
    data,
    timestamp: new Date().toISOString()
  };
}

function paginateResults(results, page, limit, total) {
  return {
    data: results,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    }
  };
}

function calculateAverageKPI(reports) {
  if (!reports.length) return 0;
  const sum = reports.reduce((total, report) => {
    // Prefer explicit final value when available
    if (typeof report.kpis?.final === 'number') return total + report.kpis.final;

    // Otherwise derive from components (supporting 6 params, fall back to 0 when missing)
    const comps = report.kpis?.components || {};
    const vals = [
      Number.isFinite(comps.simplification) ? comps.simplification : (Number.isFinite(comps.simplify) ? comps.simplify : 0),
      Number.isFinite(comps.originality) ? comps.originality : (Number.isFinite(comps.creativity) ? comps.creativity : 0),
      Number.isFinite(comps.feasibility) ? comps.feasibility : 0,
      Number.isFinite(comps.criticalThinking) ? comps.criticalThinking : 0,
      Number.isFinite(comps.proactivity) ? comps.proactivity : 0,
      Number.isFinite(comps.impact) ? comps.impact : 0
    ];
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    return total + avg;
  }, 0);
  return Math.round(sum / reports.length);
}

function formatTime(seconds) {
  if (!seconds) return '0m';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
}

function generateRandomPassword(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

module.exports = {
  formatResponse,
  paginateResults,
  calculateAverageKPI,
  formatTime,
  generateRandomPassword
};