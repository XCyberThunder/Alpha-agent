# alpha - ALPHA v1

## Date / Time
- 2026-06-06, Asia/Calcutta

## Files Changed
- `src/renderer/src/services/Alpha-voice-ai.ts`
- `src/renderer/src/UI/alpha.tsx`
- `src/renderer/src/components/MiniOverlay.tsx`
- `src/renderer/src/components/Titlebar.tsx`
- `src/renderer/src/views/Dashboard.tsx`
- `src/renderer/src/views/Settings.tsx`
- `src/renderer/src/views/Phone.tsx`
- `src/renderer/src/auth/Login.tsx`
- `src/renderer/src/UI/LockScreen.tsx`
- `src/renderer/index.html`
- `src/main/index.ts`
- `package.json`

## STT/TTS Latency Changes
- Tuned existing Gemini Live STT only; no external STT provider was added.
- Reduced Ultra STT chunk target from 8ms to 6ms.
- Lowered Ultra audio backlog cap to reduce stale packet lag.
- Made VAD interruption more responsive for faster barge-in.
- Reduced first TTS chunk scheduling delay by starting playback at the current audio clock when safe.

## Bug Fixes
- Kept internal alpha package identity, appId, icons, storage keys, IPC names, services, and classes unchanged.
- Added safe visible display alias `alpha - ALPHA` without repeating the previous full rebrand.
- Preserved Gemini as the primary realtime brain and OpenRouter as complex-task agent only.
- Excluded generated `dist*` backup folders from packaging so old alpha builds remain on disk but are not bundled into the new installer.

## Build Command Used
- `npm.cmd run build`
- `electron-builder --win --config.directories.output=dist-v1`

## Output Folder
- `dist-v1/`

## Known Issues
- Electron Builder may print dependency collector warnings for optional peer packages already present in the project tree.
- Unpacked executable depends on files in `win-unpacked`; use the setup installer for normal installation.
