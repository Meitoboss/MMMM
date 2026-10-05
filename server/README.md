# RiMusic stream server

A tiny helper you run on **your own PC / home server**. The app asks it for a song, the server gets the audio with
[yt-dlp](https://github.com/yt-dlp/yt-dlp) (which is kept up to date against YouTube's changes), caches it and streams
it back to the phone (with seeking).

## Setup (Windows)

```powershell
winget install yt-dlp.yt-dlp          # downloader
winget install DenoLand.Deno          # JavaScript runtime that recent yt-dlp needs for YouTube
winget install Gyan.FFmpeg            # recommended by yt-dlp
winget install OpenJS.NodeJS.LTS      # runs this server (Node 18+)
```

Close and reopen PowerShell, then:

```powershell
cd server
$env:KEY = "choose-a-password"        # optional but recommended
node server.mjs
```

macOS / Linux: install the same tools with brew/apt, then `KEY=choose-a-password node server.mjs`.

## Connect the phone

1. Find the PC's address: `ipconfig` → "IPv4 Address", e.g. `192.168.1.10`.
2. Allow port 8787 in Windows Firewall when asked (private networks only).
3. In the app: **Settings → Stream server** → URL `http://192.168.1.10:8787`, Key = your password.
4. Phone and PC must be on the same Wi-Fi. To use it away from home, put both on [Tailscale](https://tailscale.com)
   and use the PC's Tailscale address.

## Troubleshooting

* Test yt-dlp directly: `yt-dlp -f "bestaudio[ext=m4a]/140" -v https://www.youtube.com/watch?v=dQw4w9WgXcQ`
  – if that fails, the server will too; update with `yt-dlp -U`.
* The app shows the server's error text on the player screen.
* Extra yt-dlp options (e.g. cookies) can be passed with `YTDLP_ARGS`, e.g.
  `$env:YTDLP_ARGS = "--cookies-from-browser firefox"`.
* Cached songs are deleted after 24 h (`CACHE_HOURS`).

Environment: `PORT` (8787) · `KEY` · `YTDLP` · `CACHE_DIR` · `CACHE_HOURS` · `YTDLP_ARGS`.
