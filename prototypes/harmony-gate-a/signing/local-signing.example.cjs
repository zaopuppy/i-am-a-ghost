module.exports = {
  signingConfigs: [
    {
      name: 'default',
      type: 'HarmonyOS',
      material: {
        certpath: './signing/release/GameHack.cer',
        profile: './signing/release/gamehackRelease.p7b',
        storeFile: 'C:\\path\\outside\\the-repository\\gamehack.p12',
        storePassword: '<DevEco encrypted store password>',
        keyAlias: '<key alias>',
        keyPassword: '<DevEco encrypted key password>',
        signAlg: 'SHA256withECDSA',
      },
    },
  ],
};
