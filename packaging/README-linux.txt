TTRPG Soundboard
================

Version {{VERSION}}. A local soundboard for tabletop roleplaying games. Your sound effects and music stay in a
folder on your computer, and the app plays them in your browser.


Starting
--------

Open a terminal in this folder and run:

    ./start-soundboard.sh

Your browser then shows the app, where you choose the folder with your sounds. Keep the terminal open while you
play: closing it stops the app and the music.


Stopping
--------

Press Ctrl+C in the terminal, or type exit and press Enter.


Options
-------

Options are given to the start script, for example:

    ./start-soundboard.sh --lan

--lan lets you use a phone on the same network as a remote control. --help lists every option.


Downloading from links (optional)
---------------------------------

To add sounds and music from a link, install yt-dlp and ffmpeg and put them on your PATH, then restart the app.
Distribution packages of yt-dlp are often out of date; the file from https://github.com/yt-dlp/yt-dlp/releases/latest
works anywhere (make it executable with chmod +x), and the app keeps it up to date.

Without them, everything else works as usual. What you download, and whether the site's terms and copyright law
allow it, is your responsibility.


Updating
--------

Download the new zip, unpack it, and delete this folder. Your sound folders and your settings are stored
elsewhere and are kept.


What is in this folder
----------------------

app/        the soundboard, released into the public domain (app/LICENSE)
runtime/    Node.js {{NODE_VERSION}} from https://nodejs.org, under its own license (runtime/LICENSE)
