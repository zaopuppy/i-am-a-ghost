module.exports = {
  keyMaterial: {
    storeFile: 'C:\\path\\outside\\the-repository\\gamehack.p12',
    storePassword: '<DevEco encrypted store password>',
    keyAlias: '<key alias>',
    keyPassword: '<DevEco encrypted key password>',
    signAlg: 'SHA256withECDSA',
  },
  // Omit this block when the debug .cer/.p7b share the .p12 basename.
  debug: {
    certpath: 'C:\\path\\outside\\the-repository\\gamehack.cer',
    profile: 'C:\\path\\outside\\the-repository\\gamehack.p7b',
  },
  // Release certificate and Profile default to ./signing/release/.
};
