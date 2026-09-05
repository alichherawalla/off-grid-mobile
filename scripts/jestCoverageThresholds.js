const PRO_COVERAGE_THRESHOLD = Object.freeze({
  statements: 80,
  branches: 80,
  functions: 80,
  lines: 80,
});

/** Do not ask Jest to gate a Pro source group that is absent in open-core checkouts. */
function proCoverageThreshold(proExists) {
  return proExists ? { './pro': PRO_COVERAGE_THRESHOLD } : {};
}

module.exports = { proCoverageThreshold };
