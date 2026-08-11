import type { WidgetPreferences, WidgetStyle } from "../types";

export const FIXED_BUBBLE_WIDGET_ACCENT = "#8b86ff";
export const FIXED_BUBBLE_PANEL_ACCENT = "#faa4ce";

export function panelAccentColor(preferences: WidgetPreferences): string {
  return preferences.widgetStyle === "bubble"
    ? preferences.bubblePanelAccentColor || FIXED_BUBBLE_PANEL_ACCENT
    : preferences.accentColor;
}

export function isDarkPanelColor(color: string): boolean {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return false;
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 < 128;
}

export function hexToRgb(color: string): [number, number, number] | null {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return null;
  return [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16)) as [number, number, number];
}

export function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0")).join("")}`;
}

export function rgbToHsv(red: number, green: number, blue: number): [number, number, number] {
  const channels = [red, green, blue].map((value) => Math.min(255, Math.max(0, value)) / 255);
  const [r, g, b] = channels;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const hue = delta === 0 ? 0 : max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
  return [(hue + 360) % 360, max === 0 ? 0 : delta / max, max];
}

export function hsvToRgb(hue: number, saturation: number, value: number): [number, number, number] {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.min(1, Math.max(0, saturation));
  const v = Math.min(1, Math.max(0, value));
  const chroma = v * s;
  const x = chroma * (1 - Math.abs((h / 60) % 2 - 1));
  const [r, g, b] = h < 60 ? [chroma, x, 0] : h < 120 ? [x, chroma, 0] : h < 180 ? [0, chroma, x] : h < 240 ? [0, x, chroma] : h < 300 ? [x, 0, chroma] : [chroma, 0, x];
  const match = v - chroma;
  return [r, g, b].map((channel) => Math.round((channel + match) * 255)) as [number, number, number];
}

export function widgetAccentColor(preferences: Pick<WidgetPreferences, "accentColor" | "widgetStyle">): string {
  return preferences.widgetStyle === "bubble"
    ? FIXED_BUBBLE_WIDGET_ACCENT
    : preferences.accentColor;
}

export function withPanelAccentColor(preferences: WidgetPreferences, color: string): WidgetPreferences {
  return preferences.widgetStyle === "bubble"
    ? { ...preferences, bubblePanelAccentColor: color }
    : { ...preferences, accentColor: color };
}

export function withWidgetStyle(preferences: WidgetPreferences, widgetStyle: WidgetStyle): WidgetPreferences {
  return { ...preferences, widgetStyle };
}
