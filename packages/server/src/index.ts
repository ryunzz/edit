import { assetRoutes } from "./assets";
import { HelperServer, type Helper, type HelperOptions } from "./helper";
import { RenderQueue, renderRoutes } from "./renders";

export { HelperServer, displayPath, type Helper, type HelperOptions, type HelperContext, type CompositionEntry, type Route } from "./helper";
export { Guard } from "./security";
export { safeAssetName } from "./assets";
export { RenderQueue, listRenderFiles, type RenderJob, type RenderRequest, type RenderFile } from "./renders";

/** Starts the helper for a project: the studio, live previews and file watching. */
export async function startHelper(options: HelperOptions): Promise<Helper> {
  const helper = new HelperServer(options);
  helper.use(assetRoutes(helper.context));
  const queue = new RenderQueue(helper.context);
  helper.use(renderRoutes(helper.context, queue));
  const started = await helper.start(options.port);
  return {
    ...started,
    close: async () => {
      queue.cancelAll();
      await started.close();
    },
  };
}
