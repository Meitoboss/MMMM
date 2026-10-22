/**
 * What the home screen widget shows: the 集中 sound that is playing (its name, its beat in Hz, and whether it plays).
 * Pure logic, so it can be tested. The widget itself is in targets/widget.
 */
export interface WidgetNow {
  title: string;
  hz: number;
  playing: boolean;
}

/** the JSON the widget reads: `active: false` when no 集中 sound is on */
export function widgetPayload(now: WidgetNow | null): string {
  if (!now) return JSON.stringify({ active: false, title: '', hz: 0, playing: false });
  return JSON.stringify({ active: true, title: now.title, hz: Math.round(now.hz), playing: now.playing });
}
