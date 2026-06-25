# EMBA - ALPHA v2

- Date/time: 2026-06-10, Asia/Calcutta
- Build type: UI-only Glassmotion / Liquid Glass visual upgrade

## UI Files Changed

- `src/renderer/src/assets/main.css`
- `src/renderer/src/components/Sphere.tsx`
- `src/renderer/src/views/Dashboard.tsx`
- `src/renderer/src/components/MiniOverlay.tsx`
- `src/renderer/src/views/Settings.tsx`
- `src/renderer/src/UI/alpha.tsx`

## Visual Changes

- Added shared liquid glass classes for translucent panels, blurred cards, neon borders, glass inputs, and glass buttons.
- Updated dashboard shell, side cards, controls, hybrid chat bubbles, chat input, and send button with glassmotion styling.
- Updated floating mini overlay into a glass pill / glass mini chat panel with softer neon depth.
- Updated settings cards, tab bar, and inputs with liquid glass styling.

## Orb Animation Changes

- Added orb visual states: idle, listening, thinking, speaking, and disconnected/idle.
- Speaking state now uses smooth RGB/rainbow particle cycling instead of green-only particles.
- Added animated aura, RGB glow ring, and lightweight pulse behavior.
- Orb reads existing analyser and existing chat typing events only; no STT/TTS/Gemini audio logic was changed.

## Build Command

```powershell
npm.cmd run build
.\node_modules\.bin\electron-builder.cmd --win --config.directories.output=dist-v2
```

## Output Folder

- `dist-v2/`

## Output Files

- `dist-v2/EMBA-ALPHA-v2.exe`
- `dist-v2/EMBA-ALPHA-Setup-v2.exe`
- `dist-v2/alpha-v2.exe`
- `dist-v2/alpha-Setup-v2.exe`

## Known Issues

- Electron Builder reports peer dependency warnings for optional/peer packages, but packaging completed successfully.
- Visual verification inside the live app window was not performed from this build pass.
