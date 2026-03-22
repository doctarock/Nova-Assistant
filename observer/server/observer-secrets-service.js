import keytar from "keytar";

const DEFAULT_SERVICE_NAME = "openclaw-observer";

export function createObserverSecretsService({ serviceName = DEFAULT_SERVICE_NAME } = {}) {
  function normalizeSecretHandle(value = "") {
    const normalized = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._:/-]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return normalized;
  }

  function assertSecretHandle(value = "") {
    const handle = normalizeSecretHandle(value);
    if (!handle) {
      throw new Error("secret handle is required");
    }
    return handle;
  }

  async function setSecret(handle = "", value = "") {
    const normalizedHandle = assertSecretHandle(handle);
    const normalizedValue = String(value || "");
    if (!normalizedValue) {
      throw new Error("secret value is required");
    }
    await keytar.setPassword(serviceName, normalizedHandle, normalizedValue);
    return {
      handle: normalizedHandle,
      hasSecret: true
    };
  }

  async function getSecret(handle = "") {
    const normalizedHandle = assertSecretHandle(handle);
    return keytar.getPassword(serviceName, normalizedHandle);
  }

  async function hasSecret(handle = "") {
    const value = await getSecret(handle);
    return Boolean(String(value || ""));
  }

  async function deleteSecret(handle = "") {
    const normalizedHandle = assertSecretHandle(handle);
    const deleted = await keytar.deletePassword(serviceName, normalizedHandle);
    return {
      handle: normalizedHandle,
      deleted: deleted === true
    };
  }

  function buildWordPressSharedSecretHandle(siteId = "") {
    return assertSecretHandle(`wordpress/site/${siteId}/shared-secret`);
  }

  function buildMailAgentPasswordHandle(agentId = "") {
    return assertSecretHandle(`mail/agent/${agentId}/password`);
  }

  function buildQdrantApiKeyHandle() {
    return assertSecretHandle("retrieval/qdrant/api-key");
  }

  return {
    serviceName,
    normalizeSecretHandle,
    buildWordPressSharedSecretHandle,
    buildMailAgentPasswordHandle,
    buildQdrantApiKeyHandle,
    setSecret,
    getSecret,
    hasSecret,
    deleteSecret
  };
}
