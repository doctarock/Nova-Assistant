import { createWorkspaceTransactionService } from "./workspace-transaction-service.js";
import { createTaskFlightRecorderService } from "./task-flight-recorder-service.js";

export function createWorkspaceTransactionComposition({
  compactTaskText,
  editContainerTextFile,
  emitCoreEvent,
  fs,
  moveContainerPath,
  pathModule,
  readContainerFileBuffer,
  readTaskHistory,
  resolveToolPath,
  taskFlightRecorderRoot,
  transactionRoot,
  writeContainerTextFile
}) {
  const workspaceTransactions = createWorkspaceTransactionService({
    compactTaskText,
    editContainerTextFile,
    emitCoreEvent,
    fs,
    moveContainerPath,
    pathModule,
    readContainerFileBuffer,
    resolveToolPath,
    transactionRoot,
    writeContainerTextFile
  });

  const taskFlightRecorder = createTaskFlightRecorderService({
    compactTaskText,
    emitCoreEvent,
    fs,
    listTransactionsForTask: (...args) => workspaceTransactions.listTransactionsForTask(...args),
    pathModule,
    readTaskHistory,
    root: taskFlightRecorderRoot
  });

  const coreTransactionsCapability = {
    applyApprovedTransaction: (...args) => workspaceTransactions.applyApprovedTransaction(...args),
    approveTransaction: (...args) => workspaceTransactions.approveTransaction(...args),
    proposeExternalEditTransaction: (...args) => workspaceTransactions.proposeExternalEditTransaction(...args),
    proposeExternalSideEffectTransaction: (...args) => workspaceTransactions.proposeExternalSideEffectTransaction(...args),
    completeExternalTransaction: (...args) => workspaceTransactions.completeExternalTransaction(...args),
    listTransactionsForTask: (...args) => workspaceTransactions.listTransactionsForTask(...args),
    validateReadBasis: (...args) => workspaceTransactions.validateReadBasis(...args)
  };

  return {
    coreTransactionsCapability,
    taskFlightRecorder,
    workspaceTransactions
  };
}
