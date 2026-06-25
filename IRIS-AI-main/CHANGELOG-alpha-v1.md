# alpha v1

- Date/time: 2026-06-10, Asia/Calcutta
- Internal identity preserved as alpha for safe Electron packaging.
- Visible display name changed to `alpha`.
- STT latency tuned in the existing Gemini Live pipeline.
- TTS interruption and stale-audio cleanup tuned.
- Output folder: `dist-v1/`
- Build command: `npm.cmd run build`, then `electron-builder --win --config.directories.output=dist-v1`
- Known issue: internal installer/product identity remains alpha by design to avoid breaking packaging.
