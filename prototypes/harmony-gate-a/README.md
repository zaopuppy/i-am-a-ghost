# HarmonyOS Gate A prototype

> PROTOTYPE — throwaway validation code, not the production mobile application.

This project answers one question: can a native HarmonyOS HAP load the packaged
Vite/Three.js game in ArkWeb and keep enough native control for landscape,
lifecycle, bridge, and LAN hosting experiments?

- Bundle name: `com.zero.gamehack.iamaghost`
- Target SDK: HarmonyOS 6.1.1 / API 24 (highest scaffold SDK available locally)
- Compatible SDK: HarmonyOS 6.1.0 / API 23
- Target devices for Gate A: the connected Pura X and nova 16 Pro, both
  reporting API 26 through HDC
- Window mode: immersive landscape with status and navigation bars hidden

The desktop Vite application remains authoritative. Generated web assets are
copied into the HAP by the repository-level prototype packaging command and are
ignored by Git rather than edited in this directory. ArkWeb opens the packaged
files through a private `https://game.local/` origin; the native page resolves
that origin synchronously to HAP `$rawfile` resources so module scripts, styles,
and assets share one origin.

While the ability is in the foreground, the native layer also starts a small
TCP echo probe on an OS-assigned port and advertises it as
`_iamaghost._tcp` through mDNS. At the same time it discovers services of that
type, resolves their addresses and TXT metadata, and runs a native TCP
greeting/echo probe before reporting them as reachable. ArkWeb displays this
state as a temporary nearby-room panel. The native layer stops advertising,
discovery, and sockets on background.

This validates the LAN-hosting boundary only; the authoritative Socket.IO game
server remains in `server/` and is not duplicated in this prototype. A room can
only appear when the devices share an mDNS multicast domain and have direct TCP
reachability. Merely showing the same Wi-Fi name is not sufficient on a network
that isolates clients or assigns them to different routed links.

On HarmonyOS, **Create Room** creates a QR probe room rather than calling the
desktop Socket.IO server. The QR contains the ephemeral room code, instance,
active-network IPv4 address, and TCP probe port; it contains no token or stable
device identifier. **Scan QR Probe Room** opens the system Scan Kit UI, parses
that payload, and performs the same native greeting/echo reachability check.
This is deliberately a transport probe, not yet an authoritative playable room.

The 2026-08-21 two-device run successfully generated and scanned the QR, then
reported the endpoint as `unreachable`. That is the expected and useful result
on the currently isolated network: QR bypasses discovery failure, but cannot
bypass missing routes or client isolation.

Run from the repository root:

```powershell
npm run prototype:harmony:build
npm run prototype:harmony:run
```

The prototype and its verdict live on the `prototype/harmony-gate-a` branch.
