(() => {
const observerApp = window.ObserverApp || (window.ObserverApp = {});
const {
  buildTaskFileEntries,
  escapeHtml,
  renderTaskFilesList
} = observerApp;
function hasCoreStateBrowserUi() {
  return Boolean(
    scopeSelect
    && selectedFileEl
    && reloadFilesBtn
    && stateFileBrowserEl
    && stateTaskFilesBrowserEl
    && fileListEl
    && fileContentEl
    && taskFilesListEl
    && taskFileContentEl
  );
}

async function loadTaskFile(relativePath) {
  if (!hasCoreStateBrowserUi()) {
    return;
  }
  activeTaskFilePath = relativePath;
  selectedFileEl.value = relativePath || "";
  taskFileContentEl.textContent = "Loading task file...";
  renderTaskFilesList(buildTaskFileEntries());
  try {
    const normalizedPath = String(relativePath || "").trim();
    const isQueueFile = normalizedPath.startsWith("derpy-observer-task-queue/");
    const scope = isQueueFile ? "queue" : "workspace";
    const requestPath = isQueueFile
      ? normalizedPath.replace(/^derpy-observer-task-queue\//, "")
      : normalizedPath;
    const r = await fetch(`/api/inspect/file?scope=${encodeURIComponent(scope)}&file=${encodeURIComponent(requestPath)}`);
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load task file");
    }
    if (j.relocated && String(j.file || "").trim()) {
      activeTaskFilePath = String(j.file || "").trim();
      selectedFileEl.value = activeTaskFilePath;
    }
    taskFileContentEl.textContent = j.content || "(empty file)";
    renderTaskFilesList(buildTaskFileEntries());
  } catch (error) {
    taskFileContentEl.textContent = `Failed to load task file: ${error.message}`;
  }
}

async function loadTaskFiles(options = {}) {
  if (!hasCoreStateBrowserUi()) {
    return;
  }
  updateStateScopeView();
  if (!options.preserveSelection) {
    activeTaskFilePath = "";
  }
  const files = buildTaskFileEntries();
  renderTaskFilesList(files);
  if (!files.length) {
    selectedFileEl.value = "";
    return;
  }
  const preferredFile = activeTaskFilePath && files.some((file) => file.relativePath === activeTaskFilePath)
    ? activeTaskFilePath
    : files[0].relativePath;
  await loadTaskFile(preferredFile);
}

function isTaskFilesScopeSelected() {
  return String(scopeSelect?.value || "").trim() === "taskfiles";
}

function updateStateScopeView() {
  if (!hasCoreStateBrowserUi()) {
    return;
  }
  const taskFilesScope = isTaskFilesScopeSelected();
  if (stateFileBrowserEl) {
    stateFileBrowserEl.hidden = taskFilesScope;
  }
  if (stateTaskFilesBrowserEl) {
    stateTaskFilesBrowserEl.hidden = !taskFilesScope;
  }
  if (selectedFileEl) {
    selectedFileEl.placeholder = taskFilesScope ? "Select a task file below" : "Select a file below";
    if (!taskFilesScope && !activeFileKey) {
      selectedFileEl.value = "";
    }
    if (taskFilesScope) {
      selectedFileEl.value = activeTaskFilePath || "";
    }
  }
  if (reloadFilesBtn) {
    reloadFilesBtn.textContent = taskFilesScope ? "Reload task files" : "Reload files";
  }
}

async function loadStateInspector(options = {}) {
  if (!hasCoreStateBrowserUi()) {
    return;
  }
  updateStateScopeView();
  if (isTaskFilesScopeSelected()) {
    return loadTaskFiles({ preserveSelection: options.preserveSelection !== false });
  }
  return loadTree();
}

async function loadTree() {
  if (!hasCoreStateBrowserUi()) {
    return;
  }
  const scope = scopeSelect.value;
  updateStateScopeView();
  if (scope === "taskfiles") {
    return loadTaskFiles({ preserveSelection: true });
  }
  fileListEl.innerHTML = "Loading files...";
  fileContentEl.textContent = "Select a file to inspect.";
  selectedFileEl.value = "";
  activeFileKey = "";

  try {
    const r = await fetch(`/api/inspect/tree?scope=${encodeURIComponent(scope)}`);
    const j = await r.json();
    const entries = (j.entries || []).filter((entry) => String(entry.relativePath || "") !== ".");
    const files = entries.filter((entry) => entry.type === "file");

    if (!entries.length) {
      fileListEl.innerHTML = `<div class="panel-subtle">No files found in this scope.</div>`;
      return;
    }

    fileListEl.innerHTML = entries.map((entry) => {
      const rel = String(entry.relativePath || entry.path || "").trim();
      const isFile = entry.type === "file";
      return `<button class="file-item${isFile ? "" : " is-dir"}" data-file="${escapeHtml(rel)}" data-type="${escapeHtml(entry.type || "")}"${isFile ? "" : " disabled"}><span>${escapeHtml(rel)}</span><span class="file-type">${entry.type}</span></button>`;
    }).join("");

    fileListEl.querySelectorAll(".file-item").forEach((button) => {
      if (button.dataset.type !== "file") {
        return;
      }
      button.onclick = () => loadFile(button.dataset.file);
    });

    if (!files.length) {
      fileContentEl.textContent = "This scope currently contains directories but no readable files.";
    }
  } catch (error) {
    fileListEl.innerHTML = `<div class="panel-subtle">Failed to load files: ${escapeHtml(error.message)}</div>`;
  }
}

async function loadFile(file) {
  if (!hasCoreStateBrowserUi()) {
    return;
  }
  const scope = scopeSelect.value;
  activeFileKey = file;
  selectedFileEl.value = file;
  fileContentEl.textContent = "Loading file...";
  fileListEl.querySelectorAll(".file-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.file === file);
  });

  try {
    const r = await fetch(`/api/inspect/file?scope=${encodeURIComponent(scope)}&file=${encodeURIComponent(file)}`);
    const j = await r.json();
    fileContentEl.textContent = j.content || "(empty file)";
  } catch (error) {
    fileContentEl.textContent = `Failed to load file: ${error.message}`;
  }
}
Object.assign(observerApp, {
  hasCoreStateBrowserUi,
  isTaskFilesScopeSelected,
  updateStateScopeView,
  loadStateInspector,
  loadTaskFile,
  loadTaskFiles,
  loadTree,
  loadFile
});

})();