// @effect-diagnostics nodeBuiltinImport:off -- electron-builder loads this hook directly, outside any Effect runtime.
// Code Atlas: an unsigned macOS build gets the stable local identity before
// electron-builder zips it, so Screen Recording and Accessibility grants
// survive updates. See code-atlas-sign.sh.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

interface AfterPackContext {
  readonly appOutDir: string;
  readonly electronPlatformName: string;
  readonly packager: { readonly appInfo: { readonly productFilename: string } };
}

export default async function afterPack(context: AfterPackContext): Promise<void> {
  if (context.electronPlatformName !== "darwin") return;
  if (process.env.CODE_ATLAS_LOCAL_SIGNING === "0") return;
  const app = NodePath.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  NodeChildProcess.execFileSync(NodePath.join(import.meta.dirname, "code-atlas-sign.sh"), [app], {
    stdio: "inherit",
  });
}
