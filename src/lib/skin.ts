import type { WidgetPreferences, WidgetStyle } from "../types";

export const FIXED_BUBBLE_WIDGET_ACCENT = "#8b86ff";
export const FIXED_BUBBLE_PANEL_ACCENT = "#fd81ca";

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
