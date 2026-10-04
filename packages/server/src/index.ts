import { assetRoutes } from "./assets";
import { HelperServer, type Helper, type HelperOptions } from "./helper";

export { HelperServer, displayPath, type Helper, type HelperOptions, type HelperContext, type CompositionEntry, type Route } from "./helper";
export { Guard } from "./security";
export { safeAssetName } from "./assets";

/** Starts the helper for a project: the studio, live previews and file watching. */
export async function startHelper(options: HelperOptions): Promise<Helper> {
  const helper = new HelperServer(options);
  helper.use(assetRoutes(helper.context));
  return helper.start(options.port);
}
