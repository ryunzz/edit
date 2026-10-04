import { HelperServer, type Helper, type HelperOptions } from "./helper";

export { HelperServer, displayPath, type Helper, type HelperOptions, type HelperContext, type CompositionEntry, type Route } from "./helper";
export { Guard } from "./security";

/** Starts the helper for a project: the studio, live previews and file watching. */
export async function startHelper(options: HelperOptions): Promise<Helper> {
  const helper = new HelperServer(options);
  return helper.start(options.port);
}
