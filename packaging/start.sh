#!/bin/sh
# Starts the soundboard with the Node.js that comes with it. Options given to this script are passed on.
# Released as "Start Soundboard.command" for macOS and "start-soundboard.sh" for Linux.
cd "$(dirname "$0")" || exit 1
./runtime/node app/index.js "$@"
code=$?
# Double-clicked, the window may close as soon as this script ends, and take the error message with it.
if [ "$code" -ne 0 ]; then
	echo
	printf 'Press Enter to close.'
	read -r _
fi
exit "$code"
