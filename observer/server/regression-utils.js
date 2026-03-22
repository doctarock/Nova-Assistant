export function buildRegressionFailure(message, extra = {}) {
  return {
    passed: false,
    failures: [String(message || "Regression check failed.")],
    ...extra
  };
}

export function createLooksLikeLowSignalPlannerTaskMessage({
  normalizeSummaryComparisonText
} = {}) {
  return function looksLikeLowSignalPlannerTaskMessage(taskMessage = "", prompt = "") {
    const normalizedTask = normalizeSummaryComparisonText(taskMessage);
    const normalizedPrompt = normalizeSummaryComparisonText(prompt);
    if (!normalizedTask) {
      return true;
    }
    if (normalizedTask.length < 24) {
      return true;
    }
    return normalizedTask === normalizedPrompt;
  };
}
