export function createObserverProjectPlanning(context = {}) {
  const {
    PROJECT_ROLE_PLAYBOOKS,
    compactTaskText,
    getProjectConfig,
    inspectWorkspaceProject,
    moveContainerPath,
    normalizeSummaryComparisonText,
    path,
    readContainerFile,
    writeContainerTextFile
  } = context;

  function getProjectImplementationRoot(project, inspection) {
    const projectPath = String(project?.path || "").trim();
    if (!projectPath) {
      return "";
    }
    return projectPath;
  }

  function getProjectSpecialtyEvidence(project = {}, inspection = {}, focus = "") {
    const files = Array.isArray(inspection?.files) ? inspection.files : [];
    const directories = Array.isArray(inspection?.directories) ? inspection.directories : [];
    const corpus = [
      String(project?.name || "").trim(),
      String(project?.path || "").trim(),
      String(focus || "").trim(),
      files.join("\n"),
      directories.join("\n")
    ].join("\n").toLowerCase();
    const creativePatterns = [
      /\b(story|novel|novella|manuscript|chapter|scene|outline|arc|draft|dialogue|voice|pacing|front matter|end matter|reading copy|character|characters|world|lore)\b/g,
      /(^|\/)(manuscript|outline|chapters?|scenes?|characters?|story-bible|world|lore)(\/|$)/g
    ];
    const codePatterns = [
      /\b(package\.json|tsconfig|vite|webpack|api|frontend|backend|plugin|component|build|tests?)\b/g,
      /\.(js|jsx|ts|tsx|php|css|scss|sass|py|java|go|rs|c|cpp|cs)$/g,
      /(^|\/)(src|app|lib|components?|pages|includes|server|api|assets)(\/|$)/g
    ];
    let creativeScore = 0;
    let codeScore = 0;
    for (const pattern of creativePatterns) {
      const matches = corpus.match(pattern);
      creativeScore += matches ? matches.length : 0;
    }
    for (const pattern of codePatterns) {
      const matches = corpus.match(pattern);
      codeScore += matches ? matches.length : 0;
    }
    if (inspection?.hasPackageJson) {
      codeScore += 4;
    }
    if (inspection?.hasSource) {
      codeScore += 4;
    }
    const hasStrongCreativeStructure = files.some((file) => /(^|\/)(chapter-[^/]+|chapter\d+|scene-[^/]+|scene\d+|novella-draft|manuscript|story-outline|story-bible|character-sheet|world-guide)\.[a-z0-9]+$/i.test(String(file || "").trim()))
      || directories.some((directory) => /(^|\/)(manuscript|outline|chapters?|scenes?|characters?|story-bible|world|lore|notes)(\/|$)/i.test(String(directory || "").trim()));
    const hasCreativePrimaryInputs = files.some((file) => /(^|\/)(manuscript|outline|chapters?|scenes?|characters?|story-bible|world|lore|notes)\//i.test(String(file || "").trim()));
    const markdownFileCount = files.filter((file) => /\.md$/i.test(String(file || "").trim())).length;
    return {
      creativeScore,
      codeScore,
      hasStrongCreativeStructure,
      hasCreativePrimaryInputs,
      markdownFileCount
    };
  }

  function inferProjectCycleSpecialty(project = {}, todoState = {}, focus = "") {
    const inspection = todoState?.inspection || {};
    const focusText = String(focus || "").trim().toLowerCase();
    if (
      /\b(readme(?:\.md)?|documentation|docs?|setup|installation|getting started|current status|status report|overview|guide)\b/.test(focusText)
    ) {
      return "document";
    }
    const {
      creativeScore,
      codeScore,
      hasStrongCreativeStructure,
      hasCreativePrimaryInputs,
      markdownFileCount
    } = getProjectSpecialtyEvidence(project, inspection, focus);
    if (
      hasStrongCreativeStructure
      && (
        !inspection?.hasPackageJson
        || (!inspection?.hasSource && markdownFileCount >= 2)
        || creativeScore >= Math.max(2, codeScore)
        || hasCreativePrimaryInputs
      )
    ) {
      return "creative";
    }
    if (creativeScore >= 2 && codeScore === 0 && markdownFileCount >= 2) {
      return "creative";
    }
    if (creativeScore >= Math.max(3, codeScore + 2)) {
      return "creative";
    }
    return "code";
  }

  function findProjectDirectiveFile(inspection = {}) {
    const files = Array.isArray(inspection?.files) ? inspection.files : [];
    const directiveFile = files.find((file) => /(^|\/)directive\.md$/i.test(String(file || "").trim()));
    return String(directiveFile || "").trim();
  }

  function isDirectiveVariantFile(file = "") {
    const normalized = String(file || "").trim();
    if (!normalized) {
      return false;
    }
    const basename = path.posix.basename(normalized).toLowerCase();
    if (basename === "directive.md") {
      return false;
    }
    return basename.replace(/[^a-z0-9]/g, "") === "directivemd";
  }

  function findProjectDirectiveVariantFile(inspection = {}) {
    const files = Array.isArray(inspection?.files) ? inspection.files : [];
    const variantFile = files.find((file) => isDirectiveVariantFile(file));
    return String(variantFile || "").trim();
  }

  function normalizeDirectiveTaskLabel(text = "") {
    return compactTaskText(
      String(text || "")
        .replace(/\s+/g, " ")
        .replace(/[.;:,!?]+$/g, "")
        .trim(),
      180
    );
  }

  function isPlaceholderTaskLabel(text = "") {
    const normalized = String(text || "").trim().toLowerCase();
    return normalized === "none"
      || normalized === "n/a"
      || normalized === "na"
      || normalized === "no active tasks"
      || normalized === "no pending tasks"
      || normalized === "no completed tasks";
  }

  function extractCheckboxItems(content = "", { checked = false } = {}) {
    const pattern = checked ? /^- \[x\] (.+)$/gim : /^- \[ \] (.+)$/gm;
    return [...String(content || "").matchAll(pattern)]
      .map((match) => compactTaskText(String(match[1] || "").trim(), 180))
      .filter((entry) => entry && !isPlaceholderTaskLabel(entry));
  }

  function buildDirectiveTaskFocus(taskLabel = "", directivePath = "") {
    const normalizedLabel = normalizeDirectiveTaskLabel(taskLabel);
    if (!normalizedLabel) {
      return "";
    }
    const directiveFileName = path.posix.basename(String(directivePath || "").trim() || "directive.md");
    const normalizedLower = normalizedLabel.toLowerCase();
    if (
      normalizedLower.startsWith("complete the unchecked directive item in ")
      || normalizedLower.startsWith("complete the directive objective in ")
    ) {
      return normalizedLabel;
    }
    return compactTaskText(`Complete the unchecked directive item in ${directiveFileName}: ${normalizedLabel}.`, 220);
  }

  function extractDirectiveObjectiveText(content = "") {
    const lines = String(content || "").split(/\r?\n/);
    let insideObjectiveSection = false;
    const collected = [];
    for (const rawLine of lines) {
      const line = String(rawLine || "");
      if (/^\s*##\s+objective\s*$/i.test(line)) {
        insideObjectiveSection = true;
        continue;
      }
      if (insideObjectiveSection && /^\s*##\s+/.test(line)) {
        break;
      }
      if (!insideObjectiveSection) {
        continue;
      }
      const trimmed = line.trim();
      if (!trimmed || /^[-*]\s+/.test(trimmed)) {
        continue;
      }
      collected.push(trimmed);
    }
    if (collected.length) {
      return compactTaskText(collected.join(" "), 220);
    }
    const inlineMatch = String(content || "").match(/^\s*objective\s*:\s*(.+)$/im);
    return compactTaskText(String(inlineMatch?.[1] || "").trim(), 220);
  }

  function parseProjectDirectiveState(inspection = {}, directiveContent = "") {
    const directivePath = findProjectDirectiveFile(inspection);
    const directiveFileName = path.posix.basename(directivePath || "directive.md");
    const uncheckedItems = [];
    const checkedItems = [];
    const seenUnchecked = new Set();
    const seenChecked = new Set();
    const pushItem = (collection, seen, label) => {
      const normalizedLabel = normalizeDirectiveTaskLabel(label);
      if (!normalizedLabel) {
        return;
      }
      const dedupeKey = normalizeSummaryComparisonText(normalizedLabel);
      if (!dedupeKey || seen.has(dedupeKey)) {
        return;
      }
      seen.add(dedupeKey);
      collection.push({
        label: normalizedLabel,
        focus: buildDirectiveTaskFocus(normalizedLabel, directivePath),
        preferredTarget: directivePath
      });
    };
    for (const rawLine of String(directiveContent || "").split(/\r?\n/)) {
      const line = String(rawLine || "");
      const markdownCheckboxMatch = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/);
      if (markdownCheckboxMatch) {
        const isChecked = /x/i.test(String(markdownCheckboxMatch[1] || "").trim());
        pushItem(isChecked ? checkedItems : uncheckedItems, isChecked ? seenChecked : seenUnchecked, markdownCheckboxMatch[2]);
        continue;
      }
      const inlineCheckboxMatch = line.match(/^\s*(.+?)\s+\[([ xX])\]\s*$/);
      if (inlineCheckboxMatch) {
        const isChecked = /x/i.test(String(inlineCheckboxMatch[2] || "").trim());
        pushItem(isChecked ? checkedItems : uncheckedItems, isChecked ? seenChecked : seenUnchecked, inlineCheckboxMatch[1]);
      }
    }
    const objectiveText = extractDirectiveObjectiveText(directiveContent);
    return {
      path: directivePath,
      fileName: directiveFileName,
      objectiveText,
      uncheckedItems,
      checkedItems,
      authoritative: Boolean(directivePath && (uncheckedItems.length || checkedItems.length || objectiveText))
    };
  }

  function buildProjectDirectiveContent(project, inspection = {}) {
    const projectName = String(project?.name || "Project").trim() || "Project";
    const projectSpecialty = inferProjectCycleSpecialty(project, { inspection }, "");
    const readmeFile = pickInspectionFile(inspection, [/readme\.md$/i]);
    const packageFile = pickInspectionFile(inspection, [/package\.json$/i]);
    const manuscriptFile = pickInspectionFile(inspection, [/(chapter|scene|novella|manuscript).*\.md$/i, /\.md$/i]);
    const outlineFile = pickInspectionFile(inspection, [/(outline|beat|story-outline).*\.md$/i]);
    const notesFile = pickInspectionFile(inspection, [/(notes|story-bible|brief|characters?|world|lore).*\.md$/i]);
    if (projectSpecialty === "creative") {
      const primaryDraftTarget = manuscriptFile || outlineFile || notesFile || "the strongest current story file";
      const supportTarget = outlineFile || notesFile || manuscriptFile || "the supporting story notes";
      return [
        `# Directive: ${projectName}`,
        "",
        "## Objective",
        "Advance the strongest manuscript, outline, or story-supporting file with one concrete writing improvement.",
        "",
        "## Current Focus",
        `- [ ] Inspect ${primaryDraftTarget} and improve it directly with one meaningful writing pass.`,
        `- [ ] Preserve continuity, voice, tense, and named details against ${supportTarget}.`,
        "- [ ] Record the completed writing pass and the next follow-up in PROJECT-TODO.md and PROJECT-ROLE-TASKS.md.",
        ""
      ].join("\n");
    }
    const primaryTarget = readmeFile || packageFile || pickInspectionFile(inspection, [/\.(js|jsx|ts|tsx|py|php|java|go|rs|md)$/i]) || "the most relevant concrete project file or directory";
    return [
      `# Directive: ${projectName}`,
      "",
      "## Objective",
      "Review the project structure and identify the best runnable or shippable next step.",
      "",
      "## Current Focus",
      `- [ ] Inspect ${primaryTarget} before deciding on the next concrete pass.`,
      "- [ ] Make one concrete improvement, or record the exact blocker, in PROJECT-TODO.md and PROJECT-ROLE-TASKS.md.",
      "- [ ] Keep this directive aligned with the current objective when the project direction becomes clearer.",
      ""
    ].join("\n");
  }

  async function readProjectDirectiveState(project, inspection = {}) {
    const directivePath = findProjectDirectiveFile(inspection);
    const directiveVariantPath = findProjectDirectiveVariantFile(inspection);
    if (!directivePath && !directiveVariantPath) {
      return parseProjectDirectiveState(inspection, "");
    }
    let directiveContent = "";
    let variantContent = "";
    try {
      if (directivePath) {
        directiveContent = await readContainerFile(`${project.path}/${directivePath}`);
      }
    } catch {
      directiveContent = "";
    }
    try {
      if (directiveVariantPath) {
        variantContent = await readContainerFile(`${project.path}/${directiveVariantPath}`);
      }
    } catch {
      variantContent = "";
    }
    const canonicalState = parseProjectDirectiveState(inspection, directiveContent);
    const variantState = directiveVariantPath
      ? parseProjectDirectiveState(
        {
          ...inspection,
          files: [directivePath || "directive.md"]
        },
        variantContent
      )
      : null;
    if (
      variantState?.authoritative
      && (!canonicalState.authoritative || !String(directiveContent || "").trim())
    ) {
      return {
        ...variantState,
        path: directivePath || "directive.md",
        fileName: "directive.md"
      };
    }
    return canonicalState;
  }

  async function ensureProjectDirectiveForWorkspaceProject(project, inspection = null) {
    let resolvedInspection = inspection || await inspectWorkspaceProject(project);
    const existingDirectivePath = findProjectDirectiveFile(resolvedInspection);
    const directiveVariantPath = findProjectDirectiveVariantFile(resolvedInspection);
    if (existingDirectivePath && directiveVariantPath && typeof moveContainerPath === "function") {
      let canonicalContent = "";
      let variantContent = "";
      try {
        canonicalContent = await readContainerFile(`${project.path}/${existingDirectivePath}`);
      } catch {
        canonicalContent = "";
      }
      try {
        variantContent = await readContainerFile(`${project.path}/${directiveVariantPath}`);
      } catch {
        variantContent = "";
      }
      const canonicalState = parseProjectDirectiveState(resolvedInspection, canonicalContent);
      const variantState = parseProjectDirectiveState(
        {
          ...resolvedInspection,
          files: [existingDirectivePath || "directive.md"]
        },
        variantContent
      );
      if (
        variantState.authoritative
        && (!canonicalState.authoritative || !String(canonicalContent || "").trim())
      ) {
        await moveContainerPath(
          `${project.path}/${directiveVariantPath}`,
          `${project.path}/${existingDirectivePath}`,
          { overwrite: true, timeoutMs: 30000 }
        );
        resolvedInspection = await inspectWorkspaceProject(project);
      }
    }
    const repairedDirectivePath = findProjectDirectiveFile(resolvedInspection);
    if (repairedDirectivePath || getProjectConfig().autoCreateProjectDirective === false) {
      return {
        inspection: resolvedInspection,
        directivePath: repairedDirectivePath,
        created: false
      };
    }
    const directivePath = `${project.path}/directive.md`;
    const content = buildProjectDirectiveContent(project, resolvedInspection);
    await writeContainerTextFile(directivePath, content, { timeoutMs: 30000 });
    const refreshedInspection = await inspectWorkspaceProject(project);
    return {
      inspection: refreshedInspection,
      directivePath: findProjectDirectiveFile(refreshedInspection) || "directive.md",
      created: true
    };
  }

  function shouldRefreshLegacyPlanningContent(project, inspection = {}, content = "") {
    const projectSpecialty = inferProjectCycleSpecialty(project, { inspection }, "");
    if (projectSpecialty !== "creative") {
      return false;
    }
    const text = String(content || "");
    if (!text.trim()) {
      return false;
    }
    if (/^- \[[xX]\] .+$/m.test(text)) {
      return false;
    }
    return /\bbest runnable or shippable next step\b/i.test(text)
      || /\bpurpose, setup, and current status\b/i.test(text)
      || /\bblock another developer from running\b/i.test(text);
  }

  function pickInspectionFile(inspection, patterns = []) {
    const files = Array.isArray(inspection?.files) ? inspection.files : [];
    for (const pattern of patterns) {
      const match = files.find((file) => pattern.test(String(file || "").toLowerCase()));
      if (match) {
        return match;
      }
    }
    return files[0] || "";
  }

  function buildProjectTodoContent(project, inspection, directiveState = {}) {
    const implementationRoot = getProjectImplementationRoot(project, inspection);
    const projectSpecialty = inferProjectCycleSpecialty(project, { inspection }, "");
    const hasDirective = Boolean(findProjectDirectiveFile(inspection));
    const directiveDriven = Boolean(directiveState?.authoritative);
    const files = Array.isArray(inspection?.files) ? inspection.files : [];
    const archiveFile = pickInspectionFile(inspection, [/\.(zip|tar|tgz|tar\.gz|tar\.bz2|7z)$/i]);
    const hasConcreteNonArchiveFiles = files.some((file) => {
      const normalized = String(file || "").trim().toLowerCase();
      if (!normalized) {
        return false;
      }
      if (["project-todo.md", "project-role-tasks.md", "readme.md"].includes(normalized)) {
        return false;
      }
      return !/\.(zip|tar|tgz|tar\.gz|tar\.bz2|7z)$/i.test(normalized);
    });
    const archiveOnlyInput = Boolean(archiveFile && !hasConcreteNonArchiveFiles);
    const tasks = [];
    const completedTasks = [];
    if (directiveDriven) {
      tasks.push(
        ...(Array.isArray(directiveState?.uncheckedItems)
          ? directiveState.uncheckedItems.map((entry) => String(entry?.focus || "").trim()).filter(Boolean)
          : [])
      );
      completedTasks.push(
        ...(Array.isArray(directiveState?.checkedItems)
          ? directiveState.checkedItems.map((entry) => String(entry?.focus || "").trim()).filter(Boolean)
          : [])
      );
      if (!tasks.length && directiveState?.objectiveText) {
        tasks.push(compactTaskText(`Complete the directive objective in ${directiveState.fileName || "directive.md"}: ${directiveState.objectiveText}.`, 220));
      }
    } else if (archiveOnlyInput) {
      tasks.push(`Inspect ${archiveFile} and unzip it into the workspace so the real project files are available for concrete work.`);
      tasks.push("After extraction, identify the best runnable or shippable next step from the unpacked project files.");
      tasks.push("Update this todo file after extraction and after each concrete work pass by checking off completed items and adding any newly discovered follow-up tasks.");
    } else {
      tasks.push(projectSpecialty === "creative"
        ? "Review the project structure and identify the best shippable story or content next step."
        : "Review the project structure and identify the best runnable or shippable next step.");
      if (!hasDirective) {
        tasks.push(projectSpecialty === "creative"
          ? "Create a directive.md that names the current story objective, primary writing target, and continuity guardrails."
          : "Create a directive.md that states the current objective, primary target, and definition of done.");
      }
      if (implementationRoot && implementationRoot !== project.path) {
        tasks.push(`Treat ${implementationRoot} as the primary implementation folder for code and product files.`);
      }
      if (!inspection?.hasReadme) {
        tasks.push(projectSpecialty === "creative"
          ? "Create or improve a README that explains the project purpose, structure, active draft files, and current status."
          : "Create or improve a README that explains the project purpose, setup, and current status.");
      }
      if (inspection?.hasPackageJson) {
        tasks.push("Inspect the package scripts and verify the most useful build, run, or test workflow.");
      }
      if (inspection?.hasSource && !inspection?.hasTests) {
        tasks.push("Add or improve lightweight test coverage for the most important behavior you can verify safely.");
      }
      if (inspection?.hasTodoMarkers) {
        tasks.push("Work through the most important existing TODO or FIXME markers in the source.");
      }
      if (projectSpecialty === "creative") {
        tasks.push("Strengthen the manuscript, outline, or current scene work with one concrete writing improvement.");
        tasks.push("Preserve continuity, voice, tense, and named details while revising prose.");
      }
      tasks.push("Make one concrete improvement that advances the project meaningfully.");
      tasks.push("Update this todo file after each work pass by checking off completed items and adding any newly discovered follow-up tasks.");
    }
    const uniqueTasks = [...new Set(tasks.map((entry) => compactTaskText(entry, 220)).filter(Boolean))];
    const uniqueCompletedTasks = [...new Set(completedTasks.map((entry) => compactTaskText(entry, 220)).filter(Boolean))];
    return [
      `# Project Todo: ${project.name}`,
      "",
      "Use this file to track the current project advancement cycle.",
      "",
      "## Active Tasks",
      ...uniqueTasks.map((entry) => `- [ ] ${entry}`),
      ...uniqueCompletedTasks.map((entry) => `- [x] ${entry}`),
      "",
      "## Notes",
      `- Generated by Nova from native project inspection on ${new Date().toLocaleString("en-AU")}.`,
      inspection?.files?.length ? `- Files sampled: ${inspection.files.slice(0, 12).join(", ")}` : "- Files sampled: none.",
      directiveDriven ? `- Directive source: ${directiveState.path}.` : "",
      directiveDriven && directiveState?.objectiveText ? `- Directive objective: ${directiveState.objectiveText}` : "",
      ""
    ].join("\n");
  }

  function buildSeededRoleTaskMap(project, inspection, directiveState = {}) {
    const files = Array.isArray(inspection?.files) ? inspection.files : [];
    const directories = Array.isArray(inspection?.directories) ? inspection.directories : [];
    const implementationRoot = getProjectImplementationRoot(project, inspection);
    const projectSpecialty = inferProjectCycleSpecialty(project, { inspection }, "");
    const implementationRelRoot = implementationRoot && implementationRoot !== project.path
      ? String(implementationRoot).replace(`${project.path}/`, "")
      : "";
    const packageFile = pickInspectionFile(inspection, [/package\.json$/i]);
    const readmeFile = pickInspectionFile(inspection, [/readme\.md$/i]);
    const jsFile = pickInspectionFile(inspection, [/\.tsx?$/i, /\.jsx?$/i]);
    const cssFile = pickInspectionFile(inspection, [/\.css$/i, /\.scss$/i, /\.sass$/i]);
    const phpFile = pickInspectionFile(inspection, [/\.php$/i]);
    const archiveFile = pickInspectionFile(inspection, [/\.(zip|tar|tgz|tar\.gz|tar\.bz2|7z)$/i]);
    const manuscriptFile = pickInspectionFile(inspection, [/(chapter|scene|novella|manuscript).*\.md$/i, /\.md$/i]);
    const outlineFile = pickInspectionFile(inspection, [/(outline|beat|story-outline).*\.md$/i]);
    const notesFile = pickInspectionFile(inspection, [/(notes|story-bible|brief).*\.md$/i]);
    const characterFile = pickInspectionFile(inspection, [/(cast|character|characters).*\.md$/i]);
    const worldFile = pickInspectionFile(inspection, [/(world|lore|factions|locations).*\.md$/i]);
    const sourceDir = directories.find((entry) => /^(src|app|lib)(\/|$)/i.test(String(entry || ""))) || directories[0] || "";
    const hasConcreteNonArchiveFiles = files.some((file) => {
      const normalized = String(file || "").trim().toLowerCase();
      if (!normalized) {
        return false;
      }
      if (["project-todo.md", "project-role-tasks.md", "readme.md"].includes(normalized)) {
        return false;
      }
      return !/\.(zip|tar|tgz|tar\.gz|tar\.bz2|7z)$/i.test(normalized);
    });
    const archiveOnlyInput = Boolean(archiveFile && !hasConcreteNonArchiveFiles);
    const roleTasks = new Map();
    const add = (roleName, task) => {
      const normalized = compactTaskText(String(task || "").trim(), 180);
      if (!normalized) {
        return;
      }
      if (!roleTasks.has(roleName)) {
        roleTasks.set(roleName, []);
      }
      const existing = roleTasks.get(roleName);
      if (!existing.includes(normalized)) {
        existing.push(normalized);
      }
    };

    if (implementationRelRoot) {
      add("Project Manager", `Keep concrete implementation work inside ${implementationRelRoot} unless a root-level planning file clearly needs an update.`);
    }
    add("Project Manager", `Keep PROJECT-TODO.md and PROJECT-ROLE-TASKS.md aligned for ${project.name} after each concrete work pass.`);
    if (directiveState?.authoritative) {
      const directivePath = String(directiveState.path || "directive.md").trim();
      if (!(Array.isArray(directiveState.uncheckedItems) && directiveState.uncheckedItems.length)) {
        return roleTasks;
      }
      add("Project Manager", `Finish the current directive in ${directivePath} before broadening the pass to other project cleanup.`);
      for (const item of (Array.isArray(directiveState.uncheckedItems) ? directiveState.uncheckedItems : []).slice(0, 3)) {
        add("Project Manager", `Drive this directive item to completion and mirror it in PROJECT-TODO.md: ${item.label}.`);
      }
      if (directiveState?.objectiveText) {
        add("Product Manager", `Keep the next concrete pass anchored to the directive objective in ${directivePath}: ${directiveState.objectiveText}.`);
      }
      add("QA Tester", `Verify ${directivePath} reflects the completed directive state after each concrete pass.`);
      return roleTasks;
    }
    if (projectSpecialty === "creative") {
      add("Story Architect", `Strengthen the story shape in ${outlineFile || manuscriptFile || "the current draft"} so the next beat, escalation, and reveal timing are clearer.`);
      add("Developmental Editor", `Strengthen chapter-level pacing, stakes, and scene purpose in ${manuscriptFile || outlineFile || "the current manuscript"}.`);
      add("Line Editor", `Tighten prose, rhythm, and sentence clarity in ${manuscriptFile || "the strongest draft file"} while preserving voice.`);
      add("Continuity Editor", `Cross-check ${manuscriptFile || "the manuscript"}, ${outlineFile || "the outline"}, and ${notesFile || characterFile || worldFile || "the supporting notes"} for continuity drift before the next pass closes.`);
      add("Character Writer", `Sharpen motivation, interiority, and voice in ${characterFile || manuscriptFile || "the current character-facing scene"}.`);
      if (worldFile) {
        add("Worldbuilding Designer", `Use ${worldFile} to keep faction, location, and setting details legible and consistent with the active manuscript pass.`);
      }
      add("Content Designer", `Revise the strongest manuscript or outline file in ${project.name} with one concrete prose improvement that preserves continuity.`);
      add("Brand Designer", `Keep tone and voice consistent across the manuscript, outline, and supporting notes for ${project.name}.`);
      add("QA Tester", `Perform a fast continuity spot-check across ${manuscriptFile || "the manuscript"} and ${outlineFile || "the outline"} after each writing pass.`);
      add("Project Manager", `Turn the next manuscript or chapter improvement into a single focused work package instead of a broad writing sweep.`);
    }
    if (archiveOnlyInput) {
      add("Project Manager", `Use ${archiveFile} as the immediate intake target and unpack it before broader repo cleanup.`);
      add("DevOps Engineer", `Unzip ${archiveFile} into the workspace so the real project tree is available for inspection and edits.`);
      add("QA Tester", `Verify the extracted project files from ${archiveFile} are present and inspectable before calling the intake complete.`);
      return roleTasks;
    }
    add("Product Manager", inspection?.hasReadme
      ? (projectSpecialty === "creative"
        ? `Clarify the most shippable story or content next step for ${project.name} in PROJECT-TODO.md using evidence from ${readmeFile || "the current docs"}.`
        : `Clarify the most shippable next step for ${project.name} in PROJECT-TODO.md using evidence from ${readmeFile || "the current docs"}.`)
      : (projectSpecialty === "creative"
        ? `Create a concise README.md for ${project.name} covering purpose, structure, active draft files, and current status.`
        : `Create a concise README.md for ${project.name} covering purpose, setup, and current status.`));
    add("Project Manager", files.length
      ? `Turn the current project scan into one concrete next action tied to ${files[0]}.`
      : `Turn the current project scan into one concrete next action for ${project.name}.`);

    if (packageFile) {
      add("DevOps Engineer", `Verify the most useful run/build/test script in ${packageFile} and record the safe workflow in PROJECT-TODO.md.`);
      add("Front-End Framework Developer", `Inspect framework/tooling usage in ${packageFile} and confirm the next implementation target.`);
    }
    if (readmeFile) {
      add("Content Designer", projectSpecialty === "creative"
        ? `Tighten overview, file-map, and writing-status wording in ${readmeFile} so another contributor can continue ${project.name} confidently.`
        : `Tighten setup/status wording in ${readmeFile} so the current state of ${project.name} is clear.`);
      add("Support Engineer", projectSpecialty === "creative"
        ? `Use ${readmeFile} to identify handoff or structure gaps that would block another contributor from continuing ${project.name}.`
        : `Use ${readmeFile} to identify setup gaps that would block another developer from running ${project.name}.`);
    }
    if (jsFile) {
      add("Front-End Developer", `Inspect ${jsFile} for the most concrete UI or interaction improvement that can be shipped safely.`);
      add("QA Tester", `Define or run the smallest useful verification around ${jsFile} and capture the result in project notes.`);
    }
    if (cssFile) {
      add("UI Designer", `Review ${cssFile} for the highest-value layout or visual consistency fix.`);
      add("Accessibility Specialist", `Check ${cssFile} for styling choices that could affect readability, focus states, or contrast.`);
    }
    if (phpFile) {
      add("Back-End Developer", `Inspect ${phpFile} for one safe server-side improvement or bug fix.`);
      add("Security Engineer", `Review ${phpFile} for obvious input handling, auth, or data exposure risks.`);
      add("QA Tester", `Add or document one concrete verification path for ${phpFile}.`);
    }
    if (sourceDir && !jsFile && !phpFile) {
      add("Full-Stack Developer", `Inspect ${sourceDir} and choose one vertical-slice improvement that can be completed safely.`);
    }
    if (inspection?.hasSource && !inspection?.hasTests) {
      add("Automation QA Engineer", `Add lightweight coverage or a smoke-check around ${jsFile || phpFile || sourceDir || "the most critical source path"}.`);
    }
    if (inspection?.hasTodoMarkers) {
      add("Project Manager", `Triage the most important TODO/FIXME marker in ${jsFile || phpFile || sourceDir || "the source tree"} and turn it into a concrete work item.`);
    }
    add("Technical Architect / Solutions Architect", `Use ${sourceDir || packageFile || phpFile || readmeFile || "the sampled project files"} to record one concrete architectural or boundary decision if needed.`);
    add("Business Analyst", `Extract one missing rule, requirement, or acceptance criterion from ${readmeFile || phpFile || packageFile || "the sampled files"}.`);

    return roleTasks;
  }

  function getProjectRolePlaybookByName(roleName = "") {
    return PROJECT_ROLE_PLAYBOOKS.find((entry) => String(entry?.name || "").trim() === String(roleName || "").trim()) || null;
  }

  function deriveActiveProjectRoles(project, inspection, directiveState = {}, seededTasks = null) {
    const seededRoleTasks = seededTasks instanceof Map
      ? seededTasks
      : buildSeededRoleTaskMap(project, inspection, directiveState);
    const orderedNames = PROJECT_ROLE_PLAYBOOKS.map((entry) => entry.name);
    return orderedNames
      .filter((roleName) => Array.isArray(seededRoleTasks.get(roleName)) && seededRoleTasks.get(roleName).length)
      .map((roleName) => ({
        name: roleName,
        reason: compactTaskText(String(seededRoleTasks.get(roleName)?.[0] || "").trim(), 180)
      }));
  }

  function parseProjectRoleTaskBoardState(roleTaskContent = "", { project = null, inspection = null, directiveState = null } = {}) {
    const seededRoleTasks = project && inspection
      ? buildSeededRoleTaskMap(project, inspection, directiveState || {})
      : new Map();
    const derivedActiveRoles = project && inspection
      ? deriveActiveProjectRoles(project, inspection, directiveState || {}, seededRoleTasks)
      : [];
    const roleReports = new Map(PROJECT_ROLE_PLAYBOOKS.map((entry) => [entry.name, {
      name: entry.name,
      playbook: entry.playbook,
      checked: [],
      unchecked: [],
      recommended: [],
      explicitSelected: false
    }]));
    for (const [roleName, tasks] of seededRoleTasks.entries()) {
      if (!roleReports.has(roleName)) {
        continue;
      }
      roleReports.get(roleName).recommended = (Array.isArray(tasks) ? tasks : []).slice(0, 3);
    }
    const explicitActiveRoles = [];
    let currentRoleName = "";
    let currentSection = "";
    for (const rawLine of String(roleTaskContent || "").split(/\r?\n/)) {
      const line = String(rawLine || "");
      const headingMatch = line.match(/^\s*##\s+(.+?)\s*$/);
      if (headingMatch) {
        currentSection = String(headingMatch[1] || "").trim();
        currentRoleName = roleReports.has(currentSection) ? currentSection : "";
        continue;
      }
      if (currentSection === "Active Roles") {
        const activeMatch = line.match(/^\s*[-*]\s+([^:]+?)(?::\s*(.+))?\s*$/);
        const roleName = String(activeMatch?.[1] || "").trim();
        if (roleName && roleReports.has(roleName)) {
          explicitActiveRoles.push({
            name: roleName,
            reason: compactTaskText(String(activeMatch?.[2] || "").trim(), 180)
          });
          roleReports.get(roleName).explicitSelected = true;
        }
        continue;
      }
      if (!currentRoleName || !roleReports.has(currentRoleName)) {
        continue;
      }
      const checkboxMatch = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/);
      if (checkboxMatch) {
        const label = compactTaskText(String(checkboxMatch[2] || "").trim(), 180);
        if (!label) {
          continue;
        }
        if (/x/i.test(String(checkboxMatch[1] || "").trim())) {
          roleReports.get(currentRoleName).checked.push(label);
        } else {
          roleReports.get(currentRoleName).unchecked.push(label);
        }
        continue;
      }
      const playbookMatch = line.match(/^\s*Playbook:\s*(.+)\s*$/i);
      if (playbookMatch) {
        roleReports.get(currentRoleName).playbook = compactTaskText(String(playbookMatch[1] || "").trim(), 220);
      }
    }
    const selectedRoleMap = new Map();
    for (const entry of explicitActiveRoles.length ? explicitActiveRoles : derivedActiveRoles) {
      const roleName = String(entry?.name || "").trim();
      if (!roleName || !roleReports.has(roleName)) {
        continue;
      }
      if (!selectedRoleMap.has(roleName)) {
        selectedRoleMap.set(roleName, {
          name: roleName,
          reason: compactTaskText(String(entry?.reason || "").trim(), 180)
        });
      }
    }
    const reports = PROJECT_ROLE_PLAYBOOKS.map((entry) => {
      const base = roleReports.get(entry.name) || {
        name: entry.name,
        playbook: entry.playbook,
        checked: [],
        unchecked: [],
        recommended: [],
        explicitSelected: false
      };
      const selected = selectedRoleMap.has(entry.name) || base.explicitSelected || base.checked.length > 0 || base.unchecked.length > 0;
      const totalCount = base.checked.length + base.unchecked.length;
      return {
        name: entry.name,
        playbook: base.playbook || entry.playbook,
        selected,
        checkedCount: base.checked.length,
        uncheckedCount: base.unchecked.length,
        totalCount,
        checked: base.checked.slice(0, 4),
        unchecked: base.unchecked.slice(0, 4),
        recommended: base.recommended.slice(0, 3),
        reason: compactTaskText(String(selectedRoleMap.get(entry.name)?.reason || base.recommended?.[0] || "").trim(), 180),
        status: totalCount
          ? (base.unchecked.length ? "active" : "completed")
          : (selected ? "planned" : "idle")
      };
    });
    return {
      activeRoles: reports.filter((entry) => entry.selected).map((entry) => ({
        name: entry.name,
        reason: entry.reason
      })),
      roleReports: reports.filter((entry) => entry.selected || entry.totalCount > 0)
    };
  }

  function buildProjectRoleTaskBoardContent(project, inspection, directiveState = {}) {
    const seededTasks = buildSeededRoleTaskMap(project, inspection, directiveState);
    const activeRoles = deriveActiveProjectRoles(project, inspection, directiveState, seededTasks);
    const lines = [
      `# Project Role Tasks: ${project.name}`,
      "",
      "Use this file as the running task board for project work by role.",
      "Nova can add tasks, tick them off, and move work between roles as understanding improves.",
      "Keep tasks concrete. Prefer one-line checkbox items that point to a file, feature, defect, document, or validation target.",
      "",
      "## Active Roles",
      ...(activeRoles.length
        ? activeRoles.map((entry) => `- ${entry.name}: ${entry.reason}`)
        : ["- Project Manager: Keep the project board aligned until clearer specialist work emerges."]),
      "",
      ...PROJECT_ROLE_PLAYBOOKS.flatMap((entry) => ([
        `## ${entry.name}`,
        `Playbook: ${entry.playbook}`,
        ...(seededTasks.get(entry.name)?.length
          ? seededTasks.get(entry.name).map((task) => `- [ ] ${task}`)
          : ["No confirmed role-specific task yet from the current project scan."]),
        ""
      ])),
      "## Notes",
      `- Generated by Nova from native project inspection on ${new Date().toLocaleString("en-AU")}.`,
      inspection?.files?.length ? `- Files sampled: ${inspection.files.slice(0, 12).join(", ")}` : "- Files sampled: none.",
      "- Review PROJECT-TODO.md alongside this file for the general advancement checklist.",
      ""
    ];
    return lines.filter(Boolean).join("\n");
  }

  async function ensureProjectRoleTaskBoardForWorkspaceProject(project, inspection = null) {
    if (!getProjectConfig().autoCreateProjectRoleTasks) {
      return {
        roleTaskPath: `${project.path}/PROJECT-ROLE-TASKS.md`,
        unchecked: [],
        checked: [],
        activeRoles: [],
        roleReports: []
      };
    }
    const directiveSeed = await ensureProjectDirectiveForWorkspaceProject(project, inspection);
    const resolvedInspection = directiveSeed.inspection;
    const directiveState = await readProjectDirectiveState(project, resolvedInspection);
    const roleTaskPath = `${project.path}/PROJECT-ROLE-TASKS.md`;
    let roleTaskContent = "";
    try {
      roleTaskContent = await readContainerFile(roleTaskPath);
    } catch {
      roleTaskContent = "";
    }
    const hasRoleTaskBoard = Boolean(roleTaskContent);
    const looksLikeBlankTemplate = hasRoleTaskBoard
      && !/^- \[[ xX]\] .+/m.test(roleTaskContent)
      && /^- \[ \]$/m.test(roleTaskContent);
    const shouldRefreshLegacyBoard = hasRoleTaskBoard && shouldRefreshLegacyPlanningContent(project, resolvedInspection, roleTaskContent);
    if (!hasRoleTaskBoard || looksLikeBlankTemplate || shouldRefreshLegacyBoard) {
      const content = buildProjectRoleTaskBoardContent(project, resolvedInspection, directiveState);
      await writeContainerTextFile(roleTaskPath, content, { timeoutMs: 30000 });
      roleTaskContent = content;
    }
    if (!roleTaskContent) {
      roleTaskContent = await readContainerFile(roleTaskPath);
    }
    const unchecked = extractCheckboxItems(roleTaskContent, { checked: false });
    const checked = extractCheckboxItems(roleTaskContent, { checked: true });
    const roleState = parseProjectRoleTaskBoardState(roleTaskContent, {
      project,
      inspection: resolvedInspection,
      directiveState
    });
    return {
      roleTaskPath,
      unchecked,
      checked,
      activeRoles: Array.isArray(roleState?.activeRoles) ? roleState.activeRoles : [],
      roleReports: Array.isArray(roleState?.roleReports) ? roleState.roleReports : []
    };
  }

  async function ensureProjectTodoForWorkspaceProject(project) {
    const projectConfig = getProjectConfig();
    const directiveSeed = await ensureProjectDirectiveForWorkspaceProject(project);
    const inspection = directiveSeed.inspection;
    const directiveState = await readProjectDirectiveState(project, inspection);
    const todoPath = `${project.path}/PROJECT-TODO.md`;
    let syntheticTodoContent = "";
    if (!inspection?.hasTodo && projectConfig.autoCreateProjectTodo) {
      const content = buildProjectTodoContent(project, inspection, directiveState);
      await writeContainerTextFile(todoPath, content, { timeoutMs: 30000 });
    } else if (!inspection?.hasTodo) {
      syntheticTodoContent = buildProjectTodoContent(project, inspection, directiveState);
    }
    const roleTaskBoard = await ensureProjectRoleTaskBoardForWorkspaceProject(project, inspection);
    let todoContent = "";
    try {
      todoContent = await readContainerFile(todoPath);
    } catch {
      todoContent = syntheticTodoContent;
    }
    const todoWasBlank = !String(todoContent || "").trim();
    const todoLooksLikeBlankTemplate = !todoWasBlank
      && !/^- \[[ xX]\] .+$/m.test(todoContent)
      && /^- \[ \]$/m.test(todoContent);
    const shouldRefreshLegacyTodo = !todoWasBlank && shouldRefreshLegacyPlanningContent(project, inspection, todoContent);
    let todoRecovered = false;
    if (todoWasBlank || todoLooksLikeBlankTemplate || shouldRefreshLegacyTodo) {
      const canonicalTodoContent = buildProjectTodoContent(project, inspection, directiveState);
      if (String(canonicalTodoContent || "").trim()) {
        await writeContainerTextFile(todoPath, canonicalTodoContent, { timeoutMs: 30000 });
        todoContent = canonicalTodoContent;
        todoRecovered = true;
      }
    }
    const directiveCompleted = Boolean(
      directiveState?.authoritative
      && Array.isArray(directiveState.checkedItems)
      && directiveState.checkedItems.length
      && (!Array.isArray(directiveState.uncheckedItems) || !directiveState.uncheckedItems.length)
    );
    if (directiveCompleted) {
      const canonicalTodoContent = buildProjectTodoContent(project, inspection, directiveState);
      if (canonicalTodoContent && canonicalTodoContent.trim() !== String(todoContent || "").trim()) {
        await writeContainerTextFile(todoPath, canonicalTodoContent, { timeoutMs: 30000 });
        todoContent = canonicalTodoContent;
      }
      const canonicalRoleTaskContent = buildProjectRoleTaskBoardContent(project, inspection, directiveState);
      if (canonicalRoleTaskContent) {
        await writeContainerTextFile(roleTaskBoard.roleTaskPath, canonicalRoleTaskContent, { timeoutMs: 30000 });
      }
    }
    const unchecked = extractCheckboxItems(todoContent, { checked: false });
    const checked = extractCheckboxItems(todoContent, { checked: true });
    return {
      inspection,
      todoPath,
      roleTaskPath: roleTaskBoard.roleTaskPath,
      unchecked,
      checked,
      roleUnchecked: directiveCompleted ? [] : roleTaskBoard.unchecked,
      roleChecked: directiveCompleted ? [] : roleTaskBoard.checked,
      activeRoles: directiveCompleted ? [] : roleTaskBoard.activeRoles,
      roleReports: directiveCompleted ? [] : roleTaskBoard.roleReports,
      directiveState,
      directiveCompleted,
      todoRecovered
    };
  }

  return {
    buildProjectDirectiveContent,
    buildProjectRoleTaskBoardContent,
    buildProjectTodoContent,
    ensureProjectDirectiveForWorkspaceProject,
    ensureProjectRoleTaskBoardForWorkspaceProject,
    ensureProjectTodoForWorkspaceProject,
    findProjectDirectiveFile,
    getProjectImplementationRoot,
    inferProjectCycleSpecialty,
    parseProjectRoleTaskBoardState,
    parseProjectDirectiveState,
    pickInspectionFile,
    readProjectDirectiveState
  };
}
