# alpha v6 Build

Date: 2026-06-10 15:33 IST

## Build Command

```bash
npm.cmd run build:win
```

## Included Changes

- Task 3 local learning and memory engine.
- Task 4 multi API key slot system.
- Gemini Live Audio / STT-TTS key slots with rotation metadata.
- OpenRouter slot routing for complex-task agent.
- Existing Task 1 YouTube route and Task 2 fast local site route preserved.

## Output Folder

```text
dist-v6/
```

## Output Files

```text
dist-v6/win-unpacked/alpha.exe
dist-v6/alpha-v6.exe
dist-v6/alpha-Setup-v6.exe
dist-v6/alpha-v6-x64.nsis.7z
```

## Known Notes

- `alpha-Setup-v6.exe` is the NSIS setup launcher generated with the adjacent payload file `alpha-v6-x64.nsis.7z`.
- Keep both setup EXE and NSIS 7z payload together when sharing/installing this build.
- OpenAI/ChatGPT integration remains removed.
