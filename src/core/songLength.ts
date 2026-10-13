/**
 * How long a song is, when the player and the song disagree.
 *
 * The player reports the length of the FILE; the song carries the length it was published with. Usually they agree. When the player
 * says about TWICE the song's length (a file whose container claims twice the audio – the second half is silence), the song is
 * taken to end at its own length: the seek bar uses it, and the player moves on to the next song there instead of playing the
 * silence. Anything else (a few seconds of difference, a song whose length is not known) is left to the player.
 */
export const DOUBLED_MIN = 1.7;
export const DOUBLED_MAX = 2.3;
/** shorter songs are left alone: for a clip of a few seconds a ratio means nothing */
export const MIN_KNOWN_SECONDS = 20;

export function isDoubledDuration(playerDuration: number, songDuration?: number | null): boolean {
  if (!songDuration || songDuration < MIN_KNOWN_SECONDS || !(playerDuration > 0)) return false;
  const ratio = playerDuration / songDuration;
  return ratio >= DOUBLED_MIN && ratio <= DOUBLED_MAX;
}

/** the length the seek bar runs over (never less than 1, so that the slider always has a range) */
export function seekLength(playerDuration: number, songDuration?: number | null): number {
  const song = songDuration && songDuration > 0 ? songDuration : 0;
  if (isDoubledDuration(playerDuration, song)) return song;
  if (playerDuration > 1) return playerDuration;
  return Math.max(1, song);
}

/** where the song really ends, in seconds (null: not known) – used to fade out and to move on */
export function songEnd(playerDuration: number, songDuration?: number | null): number | null {
  if (isDoubledDuration(playerDuration, songDuration)) return songDuration ?? null;
  return playerDuration > 0 ? playerDuration : null;
}
