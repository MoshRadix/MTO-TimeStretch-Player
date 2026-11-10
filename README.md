# MTO TimeStretch Player

A desktop audio player for focused listening and practice. It supports MP3 and WAV, tempo changes with pitch preservation, independent semitone pitch shifting, a live waveform you can scrub, and optional speech clarity processing.

## Run in development

Install Node.js 20.19+ (or 22.12+), then from this folder:

```sh
npm install
npm start
```

## Build an installer

```sh
npm run pack
```

Electron 44.7.0 is pinned in `package.json`. Electron Builder targets Windows NSIS, macOS DMG, and Linux AppImage.

## Publish a Windows release

Update the package version, commit and push the changes to `main`, then run:

```sh
npm run release
```

This creates and pushes the matching `v<version>` tag. GitHub Actions builds and publishes the Windows installer and updater metadata; do not run `publish:win` locally for the same release.

## Controls

- Drag the tempo and pitch dials, use the `−` / `+` fine controls, or scroll over a dial.
- Click or drag the waveform to seek. The transport has play, stop, loop, volume, and five-second skip controls.
- Enable Voice Clarity for a speech presence filter and gentle compression.
- Open Settings to record configurable global shortcuts. Defaults are `Alt+Space` for play/pause, `Alt+Up/Down` for tempo, and `Alt+Left/Right` for pitch.

Tempo and pitch processing run through the SoundTouchJS AudioWorklet. The clarity switch adds a high-pass filter, presence EQ, and compression. Waveforms are cached on this device and partial waveform analysis is resumed when a track is reopened; the cache refreshes automatically if the audio file changes.
