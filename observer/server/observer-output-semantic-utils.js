export function createObserverOutputSemanticUtils({
  buildSemanticMap,
  formatSemanticForModel
} = {}) {
  function getToolResultSemantic(toolResult, toolName = "tool", defaultOutput = "") {
    if (toolResult && toolResult.__semantic) {
      return formatSemanticForModel(toolResult.__semantic);
    }

    if (toolResult && toolResult.stdout !== undefined) {
      const semantic = buildSemanticMap(String(toolResult.stdout || ""), toolName, {
        outputType: "text"
      });
      return formatSemanticForModel(semantic);
    }

    return defaultOutput || "";
  }

  function formatToolResultForModel(toolName, toolInput, toolOutput) {
    const semantic = buildSemanticMap(
      String(toolOutput || ""),
      toolName,
      {
        command: `${toolName}(${JSON.stringify(toolInput).substring(0, 100)})`,
        outputType: "text"
      }
    );

    return {
      tool: toolName,
      modelFormat: formatSemanticForModel(semantic),
      density: semantic.informationDensity,
      findings: semantic.keyFindings.slice(0, 3)
    };
  }

  return {
    formatToolResultForModel,
    getToolResultSemantic
  };
}
