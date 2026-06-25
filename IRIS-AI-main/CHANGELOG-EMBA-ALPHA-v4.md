# EMBA - ALPHA v4

- Date/time: 2026-06-10, Asia/Calcutta
- Build type: transparent UI repair + safe daily automation pass

## Files Changed

- `src/main/index.ts`
- `src/main/logic/web-agent.ts`
- `src/renderer/src/IndexRoot.tsx`
- `src/renderer/src/components/Sphere.tsx`
- `src/renderer/src/functions/apps-manager-api.ts`
- `src/renderer/src/services/alpha-voice-ai.ts`

## UI / Performance

- Added transparent BrowserWindow background color.
- Removed the opaque root black layer from the main shell.
- Kept panel-level glass styling instead of full-screen heavy blur.
- Reduced orb particle count from 3000 to 1800 to lower visual load and protect STT/TTS responsiveness.

## Automation

- Added fast automation routing for common website, browser, tab, scroll, window, note, reminder, volume, screenshot, folder, VS Code, terminal, WSL/Kali-style commands.
- Added direct `open-url` IPC path using Electron `shell.openExternal`.
- Kept destructive actions out of the fast automation path.

## Build Commands

```powershell
npm.cmd run build
.\node_modules\.bin\electron-builder.cmd --win --config.directories.output=dist-v4
```

## Output Folder

- `dist-v4/`

## Known Issues

- YouTube video click is best-effort through visible screen targeting when direct DOM control is unavailable.
- Electron Builder reports peer dependency warnings, but build and packaging completed successfully.
