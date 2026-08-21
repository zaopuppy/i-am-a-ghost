// @ts-nocheck – Template file, only used when copied into a project directory
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { getNode } from '@ohos/hvigor';
import { appTasks, OhosAppContext, OhosPluginId } from '@ohos/hvigor-ohos-plugin';

const projectNode = getNode(__filename);
const localSigningPath = resolve(
  __dirname,
  process.env.HARMONY_SIGNING_CONFIG ?? './signing/local-signing.cjs',
);

if (!existsSync(localSigningPath)) {
  throw new Error(
    `HarmonyOS signing is not configured. Copy signing/local-signing.example.cjs to ${localSigningPath} and fill in the local credentials.`,
  );
}

const requireLocal = createRequire(__filename);
const localSigning = requireLocal(localSigningPath);
const signingConfigs = localSigning.signingConfigs ?? localSigning.app?.signingConfigs;

if (!Array.isArray(signingConfigs) || signingConfigs.length === 0) {
  throw new Error(`HarmonyOS signing config contains no signingConfigs: ${localSigningPath}`);
}

projectNode.afterNodeEvaluate((node) => {
  const appContext = node.getContext(OhosPluginId.OHOS_APP_PLUGIN) as OhosAppContext;
  const buildProfile = appContext.getBuildProfileOpt();
  buildProfile.app.signingConfigs = signingConfigs;
  appContext.setBuildProfileOpt(buildProfile);
});

export default {
  system: appTasks /* Built-in plugin of Hvigor. It cannot be modified. */,
  plugins: [] /* Custom plugin to extend the functionality of Hvigor. */,
};
