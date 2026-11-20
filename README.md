# Drift

Living weather for your desktop: snow that piles up on your windows, rain, sakura, leaves, fireflies and starfall,
with painted wallpapers that follow the time of day. For macOS and Windows.

This page only holds the downloads. Install Drift once: after that it keeps itself up to date.

## Drift 2.2.1

- Your first automatic update: from now on, new versions of Drift arrive just like this one.
- New "Check for updates…" in the menu bar / tray menu.

| Computer | Download |
| --- | --- |
| Mac with Apple silicon (M1, M2, M3, M4…) | [Drift-2.2.1-mac-arm64.dmg](https://github.com/AlessandroAudino/drift-releases/releases/download/v2.2.1/Drift-2.2.1-mac-arm64.dmg) |
| Mac with an Intel processor | [Drift-2.2.1-mac-x64.dmg](https://github.com/AlessandroAudino/drift-releases/releases/download/v2.2.1/Drift-2.2.1-mac-x64.dmg) |
| Windows | [Drift-Setup-2.2.1.exe](https://github.com/AlessandroAudino/drift-releases/releases/download/v2.2.1/Drift-Setup-2.2.1.exe) |
| Linux | [Drift-2.2.1-linux-x86_64.AppImage](https://github.com/AlessandroAudino/drift-releases/releases/download/v2.2.1/Drift-2.2.1-linux-x86_64.AppImage) |

## Installing on a Mac

Not sure which Mac you have? Apple menu › About This Mac: "Chip: Apple M…" is Apple silicon, "Processor: … Intel" is Intel.
Open the .dmg and drag Drift into Applications. Until Drift is registered with Apple, macOS blocks it the first time:
open System Settings › Privacy & Security and click "Open Anyway". If macOS says the app is damaged, run
`xattr -cr /Applications/Drift.app` in Terminal once.

Drift reads only where windows are and how big they are, never what is in them. The only network connection it makes
is to this page, to look for new versions (Settings › General › Updates can turn that off).
