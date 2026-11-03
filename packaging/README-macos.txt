Soundboard
==========

Version {{VERSION}}. A local soundboard for tabletop roleplaying games. Your sound effects and music stay in a
folder on your computer, and the app plays them in your browser.


Starting
--------

Double-click "Start Soundboard.command". A Terminal window opens, then your browser shows the app, where you choose
the folder with your sounds. Keep the Terminal window open while you play: closing it stops the app and the music.

The first time, macOS refuses to open it, because the start file is not signed: it says Apple could not verify
that it is free of malware. Click "Done", then:

1. Open System Settings, then Privacy & Security.
2. Scroll down to the message about "Start Soundboard.command" and click "Open Anyway".
3. Confirm with your password, and click "Open Anyway" once more.

After that, a double-click is enough. When macOS asks whether Terminal may access a folder such as Documents or
Downloads, allow it if your sounds are there, so the app can see them.


Stopping
--------

Press Ctrl+C in the Terminal window, or type exit and press Enter, or close the window.


Options
-------

Options are given to the start file from a terminal. Open Terminal, type cd and a space, drag this folder onto the
Terminal window, press Enter, and run, for example:

    "./Start Soundboard.command" --lan

--lan lets you use a phone on the same network as a remote control. --help lists every option.


Downloading from links (optional)
---------------------------------

To add sounds and music from a link, install yt-dlp and ffmpeg, then restart the app. With Homebrew
(https://brew.sh):

    brew install yt-dlp ffmpeg

Without them, everything else works as usual. What you download, and whether the site's terms and copyright law
allow it, is your responsibility.


Updating
--------

Download the new zip, unpack it, and delete this folder. Your sound folders and your settings are stored
elsewhere and are kept. The new start file needs "Open Anyway" once more.


What is in this folder
----------------------

app/        the soundboard, released into the public domain (app/LICENSE)
runtime/    Node.js {{NODE_VERSION}} from https://nodejs.org, under its own license (runtime/LICENSE)
