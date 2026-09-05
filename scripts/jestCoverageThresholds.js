const PRO_COVERAGE_THRESHOLD = Object.freeze({
  statements: 75,
  branches: 75,
  functions: 75,
  lines: 75,
});

/** Do not ask Jest to gate a Pro source group that is absent in open-core checkouts. */
function proCoverageThreshold(proExists) {
  return proExists ? { './pro': PRO_COVERAGE_THRESHOLD } : {};
}

module.exports = { proCoverageThreshold };
