# Soundboard

> **Note:** This app is entirely written by AI (Claude Code) and is primarily a personal project, built for my own tabletop sessions. It is shared as is, with no promise of support or stability.

A local soundboard for running tabletop roleplaying games. Keep your sound effects and background music in a folder, open the app in a browser, and trigger them at the table.

- **Sound effects** play on a button press and can overlap.
- **Music playlists**: several can play at once (for example a tavern theme with rain on top), each with its own volume, shuffle, repeat, crossfade, fades and track start and end points.
- **Download** sounds and music from a link (YouTube and anything else `yt-dlp` supports, or a direct file link) straight into the library.
- **Remote control** from a phone on the same network (`--lan`), so the game master doesn't have to touch the laptop.

Everything runs on your machine. Audio is played in the browser; the Node.js server only scans the folder and streams the files.

## Requirements

- [Node.js](https://nodejs.org/) 24.14 or newer
- A current desktop browser
- Optional, for the download feature only: [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) and [`ffmpeg`](https://ffmpeg.org/), both installed and on your `PATH`. Without them everything else works as usual.

There is nothing to `npm install` to run the app.

**What has been tested:** the app was developed and tested on Fedora Linux, in Firefox only. Other systems (Windows, macOS) and other browsers (Chrome, Safari) may or may not work.

## Installation

These instructions are followed at your own responsibility. If you already have Node.js 24.14 or newer (`node --version`), skip step 2.

### 1. Download and unpack the app

1. On this project's GitHub page, click the green **Code** button and choose **Download ZIP**.
2. Unpack it:
   - **Windows:** right-click the ZIP and choose **Extract All…**.
   - **macOS:** double-click the ZIP.
   - **Linux:** use your file manager's "Extract here", or run `unzip Soundboard3-main.zip` in a terminal.
3. Move the unpacked folder wherever you like. You will start the app from inside it.

### 2. Install Node.js

Check the result with `node --version` in a new terminal window. It must print `v24.14.0` or higher.

- **Windows:** download the installer from [nodejs.org](https://nodejs.org/) and run it, or run `winget install OpenJS.NodeJS` in a terminal.
- **macOS:** download the installer from [nodejs.org](https://nodejs.org/), or run `brew install node` if you use [Homebrew](https://brew.sh/).
- **Linux:** package managers differ, and many ship an older Node than this app needs. Check the version first.
  - Fedora: `sudo dnf install nodejs`
  - Arch and derivatives: `sudo pacman -S nodejs`
  - Debian, Ubuntu and derivatives: the packaged version is usually too old. Use one of the options below.
  - Any distribution: [nvm](https://github.com/nvm-sh/nvm) (`nvm install 24`), or the "Linux Binaries" download on [nodejs.org](https://nodejs.org/en/download), which you unpack and add to your `PATH`.

### 3. Install yt-dlp and ffmpeg (optional)

Only needed for downloading from links. Check them with `yt-dlp --version` and `ffmpeg -version`; the app prints what it found when it starts.

**ffmpeg**
- **Windows:** `winget install ffmpeg`
- **macOS:** `brew install ffmpeg`
- **Linux:** `sudo apt install ffmpeg` (Debian, Ubuntu), `sudo dnf install ffmpeg-free` (Fedora; the full `ffmpeg` comes from [RPM Fusion](https://rpmfusion.org/)), `sudo pacman -S ffmpeg` (Arch)

**yt-dlp**
- **Windows:** `winget install yt-dlp`
- **macOS:** `brew install yt-dlp`
- **Linux:** distribution packages are often out of date. Instead, download the `yt-dlp` file from the [latest release](https://github.com/yt-dlp/yt-dlp/releases/latest), put it in a folder on your `PATH` (for example `~/.local/bin`) and make it executable with `chmod +x ~/.local/bin/yt-dlp`. Or, if you use Python, `pipx install yt-dlp`.

**Keep yt-dlp up to date.** Sites change often and old versions stop working, so update it whenever a download fails, and now and then anyway:
- Windows: `winget upgrade yt-dlp`
- macOS: `brew upgrade yt-dlp`
- Linux, downloaded file: `yt-dlp -U`
- Linux, pipx: `pipx upgrade yt-dlp`
- Installed from a distribution package: use the package manager's update.

ffmpeg rarely needs attention beyond your system's normal updates.

## Usage

Open a terminal in the unpacked folder (on Windows, right-click inside it and choose **Open in Terminal**) and run:

```
node index.js <path-to-audio-directory> [--port <number>] [--lan [<address>]] [--verbose]
```

Then open the address it prints (`http://127.0.0.1:3000` by default). To stop the app, press Ctrl+C in the terminal, or type `exit` and press Enter. Closing the terminal window also stops it, and the music with it, so keep it open during a session.

The audio directory holds `.mp3`, `.ogg` and `.opus` files. Other formats (`.wav`, `.flac`, `.m4a`, `.aac` and so on) are not supported: the app lists them as warnings at startup and skips them. You can convert them with ffmpeg, for example `ffmpeg -i input.wav -c:a libvorbis -q:a 5 output.ogg`.

```
my-soundboard/
├── Explosion.mp3        ← a sound effect
├── Door creak.ogg
├── Combat/              ← a folder is a music playlist
│   └── 01 Battle.mp3
└── Tavern/
    └── Fiddle.ogg
```

On the first run the app may ask yes/no questions in the terminal, for example whether to merge nested folders into their playlist, or whether to use the titles stored in the files' tags. Only `y` or `yes` means yes. Anything else, including just pressing Enter, means no. Answering no to the nested folders question exits without writing anything, and answering no to the titles question uses the file names as titles. After the answers it creates small `.json` files next to your audio for titles, volumes and so on. Your audio files are never modified. Deleted items go to a `.trash` folder inside the directory.

To control it from a phone, start with `--lan`. Instead of typing the address, open the ☰ menu in the app, choose **Connect a phone** and scan the QR code. You approve the device from the host machine. The app has no login, so only use `--lan` on a network you trust.

## Downloads

The download feature runs `yt-dlp` on links you paste. What you download, and whether the site's terms and copyright law allow it, is your responsibility.

## Updating

Stop the app, download the new ZIP as in the installation steps, and replace the old app folder with it. Your audio folder is separate, so nothing in it is lost. Your settings and titles live in the `.json` files inside that folder, so to back up, copy the folder.

## Troubleshooting

- **Downloads fail:** update `yt-dlp` (see above). Sites change often and old versions stop working.
- **"Downloads are off":** `yt-dlp` or `ffmpeg` was not found on your `PATH` when the app started. Install it and restart the app.
- **The port is in use:** start the app with another one, for example `--port 3001`.
- **A file doesn't show up:** check the startup warnings for an unsupported format.

## License

The code in this repository is released into the public domain under [the Unlicense](LICENSE). The vendored Tailwind CSS in `public/vendor/` keeps its own license (see the `LICENSE` file next to it).

## Development

```
npm run check    # type-check, lint and run the tests
npm run dev -- <dir>
```

See [`DESIGN.md`](DESIGN.md) for how the app works and [`TESTING.md`](TESTING.md) for the tests. Planned work is in [`ROADMAP.md`](ROADMAP.md).
