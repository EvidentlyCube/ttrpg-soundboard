# Soundboard

> **Note:** This app is entirely written by AI (Claude Code) and is primarily a personal project, built for my own tabletop sessions. It is shared as is, with no promise of support or stability.

A local soundboard for running tabletop roleplaying games. Keep your sound effects and background music in a folder, open the app in a browser, and trigger them at the table.

- **Sound effects** play on a button press and can overlap.
- **Music playlists**: several can play at once (for example a tavern theme with rain on top), each with its own volume, shuffle, repeat, crossfade, fades and track start and end points.
- **Download** sounds and music from a link (YouTube and anything else `yt-dlp` supports, or a direct file link) straight into the library.
- **Remote control** from a phone on the same network (`--lan`), so the game master doesn't have to touch the laptop.

Everything runs on your machine. Audio is played in the browser; a small server that comes with the app only reads the folder and streams the files.

**What has been tested:** the app was developed and tested on Fedora Linux, in Firefox only. Other systems (Windows, macOS) and other browsers (Chrome, Safari) may or may not work.

## Installation

These instructions are followed at your own responsibility.

1. On this project's GitHub page, open **Releases** and download the zip for your system:
   - Windows: `soundboard-<version>-windows-x64.zip`
   - macOS on Apple silicon (M1 and later): `soundboard-<version>-macos-arm64.zip`
   - macOS on Intel: `soundboard-<version>-macos-x64.zip`
   - Linux: `soundboard-<version>-linux-x64.zip`
2. Unpack it: on Windows, right-click it and choose **Extract All…**; on macOS, double-click it; on Linux, use your file manager's "Extract here" or `unzip`.
3. Move the unpacked folder wherever you like.

The zip has everything the app needs, Node.js included. There is nothing else to install, except for the optional download feature ([below](#downloading-from-links-optional)).

## Starting and stopping

- **Windows:** double-click **Start Soundboard.cmd**. The first time, Windows may show "Windows protected your PC": click **More info**, then **Run anyway**.
- **macOS:** double-click **Start Soundboard.command**. The first time, macOS refuses to open it, because it is not signed. Click **Done**, open **System Settings → Privacy & Security**, scroll down to the message about "Start Soundboard.command", click **Open Anyway**, confirm with your password, and click **Open Anyway** once more. When macOS asks whether Terminal may access a folder such as Documents, allow it if your sounds are there.
- **Linux:** open a terminal in the folder and run `./start-soundboard.sh`.

A terminal window opens, then the browser shows the app at `http://localhost:13872`. Keep the terminal window open during a session: closing it stops the app, and the music with it. To stop the app, press Ctrl+C in the terminal, type `exit` and press Enter, or close the window. If the app can't start, the window stays open with the reason until you press Enter.

Each zip also has a `README.txt` with these steps for its system.

## Choosing a soundboard

The browser first shows where to choose a soundboard: the folders you opened recently, and a folder browser. Pick the folder that holds your audio and choose **Open**, or **Create soundboard here** the first time. The app only opens folders inside your home folder.

The folder holds `.mp3`, `.ogg` and `.opus` files. Other formats (`.wav`, `.flac`, `.m4a`, `.aac` and so on) are not supported: the app lists them as problems and skips them. You can convert them with ffmpeg, for example `ffmpeg -i input.wav -c:a libvorbis -q:a 5 output.ogg`.

```
my-soundboard/
├── Explosion.mp3        ← a sound effect
├── Door creak.ogg
├── Combat/              ← a folder is a music playlist
│   └── 01 Battle.mp3
└── Tavern/
    └── Fiddle.ogg
```

The first time a folder is opened, the browser may ask a few questions: whether to merge folders nested inside a playlist into it, and whether to use the titles stored in the files' tags. The app then creates small `.json` files next to your audio for titles, volumes and so on. Your audio files are never modified. Deleted items go to a `.trash` folder inside the soundboard folder. **Change soundboard** in the ☰ menu goes back to choosing a folder.

## Options

Options are added after the start command, from a terminal opened in the app's folder:

- Windows (PowerShell): `& '.\Start Soundboard.cmd' --lan`
- macOS: `"./Start Soundboard.command" --lan`
- Linux: `./start-soundboard.sh --lan`

The most useful ones:

- `--lan` lets a phone on the same network work as a remote control. Open the ☰ menu in the app, choose **Connect a phone** and scan the QR code. You approve the device from the host machine. The app has no login, so only use `--lan` on a network you trust.
- `--port <number>` uses another port than `13872`. When the port is taken, the app tries the next nine by itself.
- `--whitelisted-root <path>` lets the app open folders outside your home folder.
- `--help` lists every option.

## Downloading from links (optional)

The download feature needs [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) and [`ffmpeg`](https://ffmpeg.org/), installed and on your `PATH`. Without them, everything else works as usual. The app shows what it found on its start page and in **Info** in the ☰ menu. Restart the app after installing them.

**ffmpeg**
- **Windows:** `winget install ffmpeg`
- **macOS:** `brew install ffmpeg` (with [Homebrew](https://brew.sh/))
- **Linux:** `sudo apt install ffmpeg` (Debian, Ubuntu), `sudo dnf install ffmpeg-free` (Fedora; the full `ffmpeg` comes from [RPM Fusion](https://rpmfusion.org/)), `sudo pacman -S ffmpeg` (Arch)

**yt-dlp**
- **Windows:** `winget install yt-dlp`
- **macOS:** `brew install yt-dlp`
- **Linux:** distribution packages are often out of date. Instead, download the `yt-dlp` file from the [latest release](https://github.com/yt-dlp/yt-dlp/releases/latest), put it in a folder on your `PATH` (for example `~/.local/bin`) and make it executable with `chmod +x ~/.local/bin/yt-dlp`. Or, if you use Python, `pipx install yt-dlp`.

Sites change often and old versions of yt-dlp stop working. The app runs `yt-dlp -U` each time it starts, which updates yt-dlp when it was installed as a downloaded file. When it was installed another way, update it the same way: `winget upgrade yt-dlp`, `brew upgrade yt-dlp`, `pipx upgrade yt-dlp` or your package manager.

The download feature runs `yt-dlp` on links you paste. What you download, and whether the site's terms and copyright law allow it, is your responsibility.

## Updating

Stop the app, download and unpack the new zip, and delete the old app folder. Nothing you made is lost: titles, volumes and other settings live in the `.json` files inside your soundboard folder, and the list of recent folders lives in your user settings folder. To back up a soundboard, copy its folder. On macOS, the new start file needs **Open Anyway** once more.

## Troubleshooting

- **Downloads fail:** update `yt-dlp` (see above).
- **"Downloads are off":** `yt-dlp` or `ffmpeg` was not found on your `PATH` when the app started. Install it and restart the app.
- **A folder can't be opened:** the app only opens folders inside your home folder, and no hidden ones. See `--whitelisted-root` and `--allow-hidden` in `--help`.
- **A file doesn't show up:** check the Problems button in the app for an unsupported format.

## Running from source

Instead of a release zip, you can run the app with your own [Node.js](https://nodejs.org/) 24.14 or newer. Download the source (the green **Code** button, then **Download ZIP**), unpack it, open a terminal in it and run:

```
node index.js
```

It takes the same options as the start files. There is nothing to `npm install` to run the app.

## License

The code in this repository is released into the public domain under [the Unlicense](LICENSE). The vendored Tailwind CSS in `public/vendor/` keeps its own license (see the `LICENSE` file next to it). The release zips also carry Node.js, under its own license (`runtime/LICENSE`).

## Development

```
npm run check    # type-check, lint and run the tests
npm run dev
npm run pack     # build the release zips into dist/
```

A release is made by changing `version` in `package.json` in a commit of its own and pushing it to `main`. See [`DESIGN.md`](DESIGN.md) for how the app works and [`TESTING.md`](TESTING.md) for the tests. Planned work is in [`ROADMAP.md`](ROADMAP.md).
