import { registerIntakeRoutingRoutes } from "./intake-routing-domain.js";
import { registerQueueEngineRoutes } from "./queue-engine-domain.js";
import { registerWorkerExecutionRoutes } from "./worker-execution-domain.js";
import { registerRuntimeRoutes } from "./runtime-domain.js";
import { registerObserverConfigRoutes } from "./observer-config-domain.js";
import { registerCronRoutes } from "./cron-domain.js";
import {
  initializeObserverRuntime,
  runDeferredObserverRuntimeInitialization,
  startObserverHttpServer
} from "./observer-bootstrap-service.js";

export async function composeObserverServer(context = {}) {
  const {
    initializeArgs,
    startArgs,
    runtimeRouteArgs,
    intakeRouteArgs,
    observerConfigRouteArgs,
    workerExecutionRouteArgs,
    queueEngineRouteArgs,
    cronRouteArgs
  } = context;

  registerRuntimeRoutes(runtimeRouteArgs);
  registerIntakeRoutingRoutes(intakeRouteArgs);
  registerObserverConfigRoutes(observerConfigRouteArgs);
  registerWorkerExecutionRoutes(workerExecutionRouteArgs);
  registerQueueEngineRoutes(queueEngineRouteArgs);
  registerCronRoutes(cronRouteArgs);

  await initializeObserverRuntime({
    ...initializeArgs,
    deferHeavyInitialization: true
  });
  startObserverHttpServer({
    ...startArgs,
    runDeferredRuntimeInitialization: async () =>
      await runDeferredObserverRuntimeInitialization(initializeArgs)
  });
}
