const teamService = require('../services/teamService');

async function getProblems(req, res, next) {
  try {
    const problems = await teamService.getTeamProblems(req.user.companyId);
    res.json(problems);
  } catch (err) { next(err); }
}

async function getSolutions(req, res, next) {
  try {
    const solutions = await teamService.getTeamSolutions(req.user.companyId, req.user.id);
    res.json(solutions);
  } catch (err) { next(err); }
}

async function likeSolution(req, res, next) {
  try {
    const solutionId = parseInt(req.params.id);
    const result = await teamService.toggleLike(solutionId, req.user.id);
    res.json(result);
  } catch (err) { next(err); }
}

async function startProblemTest(req, res, next) {
  try {
    const { problemId } = req.body;
    if (!problemId) return res.status(400).json({ error: 'problemId is required' });

    const problems = await teamService.getTeamProblems(req.user.companyId);
    const problem = problems.find(p => p.id === problemId);
    if (!problem) return res.status(404).json({ error: 'Problem not found' });

    const result = await teamService.startTeamTest(req.user, {
      brief: `Problem: ${problem.topic}\n\n${problem.description}`,
      title: `Challenge: ${problem.topic}`
    });

    res.json(result);
  } catch (err) { next(err); }
}

async function startSolutionTest(req, res, next) {
  try {
    const { solutionId } = req.body;
    if (!solutionId) return res.status(400).json({ error: 'solutionId is required' });

    const solutions = await teamService.getTeamSolutions(req.user.companyId, req.user.id);
    const solution = solutions.find(s => s.id === solutionId);
    if (!solution) return res.status(404).json({ error: 'Solution not found' });

    const result = await teamService.startTeamTest(req.user, {
      brief: `Solution: ${solution.topic}\n\n${solution.description}`,
      title: `Improve: ${solution.topic}`
    });

    res.json(result);
  } catch (err) { next(err); }
}

module.exports = {
  getProblems,
  getSolutions,
  likeSolution,
  startProblemTest,
  startSolutionTest
};
