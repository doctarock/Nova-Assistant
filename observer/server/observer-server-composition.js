import { registerIntakeRoutingRoutes } from "./intake-routing-domain.js";
import { registerQueueEngineRoutes } from "./queue-engine-domain.js";
import { registerMailCalendarRoutes } from "./mail-calendar-domain.js";
import { registerWorkerExecutionRoutes } from "./worker-execution-domain.js";
import { registerRuntimeRoutes } from "./runtime-domain.js";
import { registerObserverConfigRoutes } from "./observer-config-domain.js";
import { registerCronRoutes } from "./cron-domain.js";
import {
  initializeObserverRuntime,
  startObserverHttpServer
} from "./observer-bootstrap-service.js";

export async function composeObserverServer(context = {}) {
  const {
    initializeArgs,
    startArgs,
    runtimeRouteArgs,
    intakeRouteArgs,
    observerConfigRouteArgs,
    mailCalendarRouteArgs,
    workerExecutionRouteArgs,
    queueEngineRouteArgs,
    cronRouteArgs
  } = context;

  registerRuntimeRoutes(runtimeRouteArgs);
  registerIntakeRoutingRoutes(intakeRouteArgs);
  registerObserverConfigRoutes(observerConfigRouteArgs);
  registerMailCalendarRoutes(mailCalendarRouteArgs);
  registerWorkerExecutionRoutes(workerExecutionRouteArgs);
  registerQueueEngineRoutes(queueEngineRouteArgs);
  registerCronRoutes(cronRouteArgs);

  await initializeObserverRuntime(initializeArgs);
  startObserverHttpServer(startArgs);
}
