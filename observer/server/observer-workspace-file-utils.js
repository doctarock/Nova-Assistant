export function createObserverWorkspaceFileUtils({
  fs,
  path: pathModule,
  observerAttachmentsRoot,
  observerContainerAttachmentsRoot,
  promptWorkspaceRoot,
  agentWorkspacesRoot
} = {}) {
  function sanitizeAttachmentName(name, index) {
    const baseName = pathModule.basename(String(name || `attachment-${index + 1}`));
    const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
    return safeName || `attachment-${index + 1}`;
  }

  function buildAttachmentAlias(name, index) {
    const extension = pathModule.extname(String(name || ""));
    const safeExtension = extension.replace(/[^a-zA-Z0-9.]/g, "");
    return `attachment-${index + 1}${safeExtension || ""}`;
  }

  async function writeVolumeFile(filePath, contentBase64) {
    await fs.mkdir(pathModule.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, Buffer.from(String(contentBase64 || ""), "base64"));
  }

  async function prepareAttachments(attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) {
      return null;
    }

    const runFolder = `run-${Date.now()}`;
    const volumeRoot = `${observerAttachmentsRoot}/${runFolder}`;
    const workspaceRoot = `${observerContainerAttachmentsRoot}/${runFolder}`;
    const files = [];

    for (let index = 0; index < attachments.length; index += 1) {
      const attachment = attachments[index] || {};
      const originalName = sanitizeAttachmentName(attachment.name, index);
      const fileName = buildAttachmentAlias(originalName, index);
      const contentBase64 = String(attachment.contentBase64 || "");
      const bytes = Buffer.from(contentBase64, "base64");
      const volumePath = `${volumeRoot}/${fileName}`;
      await writeVolumeFile(volumePath, contentBase64);
      files.push({
        name: fileName,
        originalName: String(attachment.name || originalName),
        type: String(attachment.type || "application/octet-stream"),
        size: bytes.length,
        containerPath: `${workspaceRoot}/${fileName}`
      });
    }

    return { volumeRoot, workspaceRoot, files };
  }

  async function appendVolumeText(filePath, content) {
    await fs.mkdir(pathModule.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, content, "utf8");
  }

  async function fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async function clearDirectoryContents(dirPath) {
    await fs.mkdir(dirPath, { recursive: true });
    const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") {
        return [];
      }
      throw error;
    });
    await Promise.all(entries.map((entry) => (
      fs.rm(pathModule.join(dirPath, entry.name), { recursive: true, force: true })
    )));
  }

  async function removeDateStampedMarkdownFiles(dirPath) {
    await fs.mkdir(dirPath, { recursive: true });
    const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") {
        return [];
      }
      throw error;
    });
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/i.test(entry.name))
        .map((entry) => fs.rm(pathModule.join(dirPath, entry.name), { force: true }))
    );
  }

  return {
    appendVolumeText,
    clearDirectoryContents,
    fileExists,
    prepareAttachments,
    removeDateStampedMarkdownFiles,
    writeVolumeFile
  };
}
