#!/bin/sh
# Test stub that mimics yt-dlp: writes 5000 bytes to the -o template.
while [ $# -gt 0 ]; do
  if [ "$1" = "-o" ]; then OUT="$2"; shift; fi
  shift
done
FILE=$(echo "$OUT" | sed 's/%(ext)s/m4a/')
head -c 5000 /dev/zero | tr '\0' 'a' > "$FILE"
