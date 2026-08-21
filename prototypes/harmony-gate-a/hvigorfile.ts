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

if (existsSync(localSigningPath)) {
  const requireLocal = createRequire(__filename);
  const localSigning = requireLocal(localSigningPath);
  const legacySigningConfigs = localSigning.signingConfigs ?? localSigning.app?.signingConfigs;
  const legacySigningConfig = Array.isArray(legacySigningConfigs) ? legacySigningConfigs[0] : undefined;
  const keyMaterial = localSigning.keyMaterial ?? legacySigningConfig?.material;

  if (typeof keyMaterial !== 'object' || keyMaterial === null) {
    throw new Error(`HarmonyOS signing config contains no keyMaterial: ${localSigningPath}`);
  }

  for (const field of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) {
    if (typeof keyMaterial[field] !== 'string' || keyMaterial[field].length === 0) {
      throw new Error(`HarmonyOS signing keyMaterial is missing ${field}: ${localSigningPath}`);
    }
  }

  const debugCertpath = localSigning.debug?.certpath
    ?? keyMaterial.storeFile.replace(/\.p12$/i, '.cer');
  const debugProfile = localSigning.debug?.profile
    ?? keyMaterial.storeFile.replace(/\.p12$/i, '.p7b');
  const releaseCertpath = localSigning.release?.certpath
    ?? './signing/release/GameHack.cer';
  const releaseProfile = localSigning.release?.profile
    ?? './signing/release/gamehackRelease.p7b';
  const signingType = localSigning.type ?? legacySigningConfig?.type ?? 'HarmonyOS';
  const sharedMaterial = {
    storeFile: keyMaterial.storeFile,
    storePassword: keyMaterial.storePassword,
    keyAlias: keyMaterial.keyAlias,
    keyPassword: keyMaterial.keyPassword,
    signAlg: keyMaterial.signAlg ?? 'SHA256withECDSA',
  };
  const signingConfigs = [
    {
      name: 'debug',
      type: signingType,
      material: {
        ...sharedMaterial,
        certpath: debugCertpath,
        profile: debugProfile,
      },
    },
    {
      name: 'release',
      type: signingType,
      material: {
        ...sharedMaterial,
        certpath: releaseCertpath,
        profile: releaseProfile,
      },
    },
  ];

  projectNode.afterNodeEvaluate((node) => {
    const appContext = node.getContext(OhosPluginId.OHOS_APP_PLUGIN) as OhosAppContext;
    const buildProfile = appContext.getBuildProfileOpt();
    buildProfile.app.signingConfigs = signingConfigs;
    appContext.setBuildProfileOpt(buildProfile);
  });
} else {
  console.warn(
    `HarmonyOS signing is not configured. Native builds will be unsigned until ${localSigningPath} is created.`,
  );
}

export default {
  system: appTasks /* Built-in plugin of Hvigor. It cannot be modified. */,
  plugins: [] /* Custom plugin to extend the functionality of Hvigor. */,
};
