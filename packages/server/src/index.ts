import { ActivityFeed, activityRoutes } from "./activity";
import { assetRoutes } from "./assets";
import { HelperServer, type Helper, type HelperOptions } from "./helper";
import { RenderQueue, renderRoutes } from "./renders";
import { selectionRoutes } from "./selection";

export { HelperServer, displayPath, type Helper, type HelperOptions, type HelperContext, type CompositionEntry, type Route } from "./helper";
export { Guard } from "./security";
export { safeAssetName } from "./assets";
export { type Selection } from "./selection";
export { ActivityFeed, lineDiff, type ActivityEvent } from "./activity";
export { RenderQueue, listRenderFiles, type RenderJob, type RenderRequest, type RenderFile } from "./renders";

/** Starts the helper for a project: the studio, live previews and file watching. */
export async function startHelper(options: HelperOptions): Promise<Helper> {
  const helper = new HelperServer(options);
  helper.use(assetRoutes(helper.context));
  const queue = new RenderQueue(helper.context);
  helper.use(renderRoutes(helper.context, queue));
  const feed = new ActivityFeed(helper.context);
  feed.snapshotAll();
  helper.onChange((c) => feed.onChange(c));
  helper.use(activityRoutes(helper.context, feed));
  helper.use(selectionRoutes(helper.context));
  // An agent's tools stop with its session; tell the studio when that happens.
  feed.checkAgent();
  const agentCheck = setInterval(() => feed.checkAgent(), 3000);
  const started = await helper.start(options.port);
  return {
    ...started,
    close: async () => {
      clearInterval(agentCheck);
      queue.cancelAll();
      await started.close();
    },
  };
}
