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

While the ability is in the foreground, the native layer starts a framed TCP
transport on an OS-assigned port and advertises it as
`_iamaghost._tcp` through mDNS. At the same time it discovers services of that
type, resolves their addresses and TXT metadata, and runs a native TCP
room-info probe. ArkWeb only presents endpoints whose owner has explicitly
created a room. The native layer stops advertising, discovery, and sockets on
background.

The H3 slice can now create a room, join it from the nearby list, enter a shared
lobby, start a match, and exchange 30 Hz inputs / 20 Hz viewer-projected frames.
The host ArkWeb runs the shared `MatchEngine` in a Web Worker; ArkTS owns TCP
connections, bounded UTF-8 newline framing, peer queues, and directed sends.
The desktop Socket.IO game server remains unchanged. This is still a disposable
architecture probe: it uses a 25 ms JavaScript-proxy polling bridge and has not
yet passed the planned `WebMessagePort` / `ArrayBuffer` soak test.

On HarmonyOS, **Create Room** activates the native endpoint and opens the local
hosted lobby rather than calling the desktop Socket.IO server. The QR contains
the ephemeral room code, instance, active-network IPv4 address, and TCP port;
it contains no token or stable device identifier. Nearby room buttons, six-digit
code lookup, and **Scan QR Game Room** all converge on the same persistent TCP
join path.

The first 2026-08-21 two-device run was isolated and correctly reported the QR
endpoint as `unreachable`. After both phones moved to a LAN that permits client
traffic, each phone discovered the other and completed the native probe. H3 then
completed a real two-phone room flow: nearby-list join, synchronized two-player
lobby, host start, distinct ghost/child viewer frames, authoritative movement
from both touch joysticks, and a held child flashlight action. The discovery and
QR debug overlays now close during play so the landscape HUD remains usable.

H3 does not complete Gate A. A successful real QR join on the new LAN, game-time
host-background handling, the `WebMessagePort` / `ArrayBuffer` bridge, 15-minute
soak, and device performance/thermal measurements remain open.

Run from the repository root:

```powershell
npm run prototype:harmony:build
npm run prototype:harmony:run
```

The prototype and its verdict live on the `prototype/harmony-gate-a` branch.
