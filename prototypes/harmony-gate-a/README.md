# HarmonyOS Gate A prototype

> PROTOTYPE — throwaway validation code, not the production mobile application.

This project answers one question: can a native HarmonyOS HAP load the packaged
Vite/Three.js game in ArkWeb and keep enough native control for landscape,
lifecycle, bridge, and LAN hosting experiments?

- Bundle name: `com.zero.gamehack.iamaghost`
- Target SDK: HarmonyOS 6.1.1 / API 24 (highest scaffold SDK available locally)
- Compatible SDK: HarmonyOS 6.1.0 / API 23
- Target device for Gate A: the connected Pura X reporting API 26 through HDC

The desktop Vite application remains authoritative. Generated web assets will be
copied into the HAP by the repository-level prototype packaging command rather
than edited in this directory.

Run from this directory:

```powershell
devecocli build
devecocli run --module entry
```

The prototype and its verdict live on the `prototype/harmony-gate-a` branch.
