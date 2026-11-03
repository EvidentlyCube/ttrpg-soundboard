Soundboard
==========

Version {{VERSION}}. A local soundboard for tabletop roleplaying games. Your sound effects and music stay in a
folder on your computer, and the app plays them in your browser.


Starting
--------

Double-click "Start Soundboard.cmd". A terminal window opens, then your browser shows the app, where you choose the
folder with your sounds. Keep the terminal window open while you play: closing it stops the app and the music.

The first time, Windows may show "Windows protected your PC". Click "More info", then "Run anyway". It asks because
the start file is not signed.


Stopping
--------

Type exit in the terminal window and press Enter, or close the window. Ctrl+C works too. Windows then asks
"Terminate batch job (Y/N)?"; either answer is fine, since the app has already stopped.


Options
-------

Options are given to the start file from a terminal. Right-click inside this folder, choose "Open in Terminal",
and run, for example:

    & '.\Start Soundboard.cmd' --lan

--lan lets you use a phone on the same network as a remote control. --help lists every option.


Downloading from links (optional)
---------------------------------

To add sounds and music from a link, install yt-dlp and ffmpeg, then restart the app:

    winget install yt-dlp
    winget install ffmpeg

Without them, everything else works as usual. What you download, and whether the site's terms and copyright law
allow it, is your responsibility.


Updating
--------

Download the new zip, unpack it, and delete this folder. Your sound folders and your settings are stored
elsewhere and are kept.


What is in this folder
----------------------

app\        the soundboard, released into the public domain (app\LICENSE)
runtime\    Node.js {{NODE_VERSION}} from https://nodejs.org, under its own license (runtime\LICENSE)
