/* Register umf.app 0.1 and umf.ux 0.1 with a UMF Registry, through UMF's
   public extension API only (Registry#register(package, semantics)), the same
   way umf-visual registers umf.visual. The caller supplies the registry
   (typically createUmfRegistry() from @umf/core, which already carries
   umf.actions, umf.ddd and umf.dashboard), so this package has no dependency
   on UMF's native SDK and runs in the browser too. */

import appPackage from "../vocabularies/umf.app.0.1.0.json" with { type: "json" };
import uxPackage from "../vocabularies/umf.ux.0.1.0.json" with { type: "json" };
import { appSemantics, uxSemantics } from "./semantics.mjs";

export { appPackage, uxPackage };

export function registerAppVocabularies(registry) {
  registry.register(appPackage, appSemantics);
  registry.register(uxPackage, uxSemantics);
  return registry;
}
