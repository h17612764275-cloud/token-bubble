import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { QuotaCard, QuotaOrb } from "./components/QuotaCard";
import { PinnedScreenshot } from "./components/PinnedScreenshot";
import { ScreenshotOverlay } from "./components/ScreenshotOverlay";
import { TrayPanel } from "./components/TrayPanel";
import { broadcastSnapshots, fetchSnapshots, getPreferences, listenDesktopEvents, registerVoiceShortcut, resizeFloatingWidget, setWidgetExpanded, setWidgetPositionLocked, startDragging, startVoice, stopVoice, toggleFloatingWidget, togglePanelFromWidget, updatePreferences } from "./lib/bridge";
import { needsFastRefresh } from "./lib/format";
import { checkForAppUpdate } from "./lib/appUpdate";
import { copy, normalizeLanguage } from "./lib/i18n";
import { filterSnapshotUpdates, mergeSnapshotUpdates, mergeSnapshots } from "./lib/snapshots";
import { recordDailyUsage } from "./lib/dailyUsage";
import { withPanelAccentColor, withWidgetStyle } from "./lib/skin";
import { recordVoiceText } from "./lib/voiceHistory";
import type { ProviderSnapshot, VoiceEvent, WidgetPreferences } from "./types";

const DEFAULT_PREFS: WidgetPreferences = { locked: false, positionLocked: false, widgetSize: 68, accentColor: "#b97892", bubblePanelAccentColor: "#faa4ce", widgetStyle: "bubble", alwaysOnTop: true, stayExpanded: false, pinnedProvider: null, autoRotateSeconds: 12, language: "zh-CN", voiceEnabled: false, voiceShortcut: "Ctrl+Space", voiceInputDevice: null, voiceSensitivity: 65, screenshotShortcut: "Ctrl+P", screenshotFolder: "" };

export default function App() {
  const bootstrap = window as typeof window & { __TOKEN_BUBBLE_VIEW__?: string };
  const view = bootstrap.__TOKEN_BUBBLE_VIEW__ ?? new URLSearchParams(window.location.search).get("view");
  const nativeLabel = "__TAURI_INTERNALS__" in window ? getCurrentWindow().label : "";
  if (nativeLabel === "screenshot" || view === "screenshot") return <ScreenshotOverlay />;
  if (nativeLabel.startsWith("pin-") || view === "pin") return <PinnedScreenshot />;
  return <QuotaApp isTrayPanel={nativeLabel === "tray-panel" || view === "tray"} />;
}

function QuotaApp({ isTrayPanel }: { isTrayPanel: boolean }) {
  const [snapshots, setSnapshots] = useState<ProviderSnapshot[]>([]);
  const [preferences, setPreferences] = useState(DEFAULT_PREFS);
  const [voiceEvent, setVoiceEvent] = useState<VoiceEvent>({ status: "disabled", level: 0 });
  const [voiceRevision, setVoiceRevision] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [compact, setCompact] = useState(true);
  const [consumingProviders, setConsumingProviders] = useState<Set<string>>(() => new Set());
  const [operationError, setOperationError] = useState<string | null>(null);
  const [showUpdateFallback, setShowUpdateFallback] = useState(false);
  const failures = useRef(0);
  const snapshotsRef = useRef<ProviderSnapshot[]>([]);
  const successfulSnapshotVersions = useRef(new Map<ProviderSnapshot["provider"], number>());
  const previousPrimary = useRef(new Map<string, number>());
  const consumptionTimers = useRef(new Map<string, number>());
  const collapseTimer = useRef<number | null>(null);
  const hoverSequence = useRef(0);
  const preferencesRef = useRef(preferences);
  const language = normalizeLanguage(preferences.language);
  const t = copy[language];

  const checkUpdate = useCallback((manual = false) => {
    setShowUpdateFallback(false);
    void checkForAppUpdate(language, {
      checking: t.updateChecking,
      current: t.updateCurrent,
      downloading: t.updateDownloading,
      installing: t.updateInstalling,
      availableWindows: t.updateAvailableWindows,
      availableMac: t.updateAvailableMac,
      failed: t.updateFailed,
    }, (message) => {
      setOperationError(message);
      if (message === t.updateFailed) setShowUpdateFallback(true);
    }, manual);
  }, [language, t]);

  const applySnapshots = useCallback((values: ProviderSnapshot[], mode: "full" | "partial" = "full"): ProviderSnapshot[] => {
    const accepted = filterSnapshotUpdates(snapshotsRef.current, values);
    if (accepted.length === 0) return [];
    const effectiveMode = mode === "partial" || accepted.length < values.length ? "partial" : "full";
    const next = effectiveMode === "partial"
      ? mergeSnapshotUpdates(snapshotsRef.current, accepted)
      : mergeSnapshots(snapshotsRef.current, accepted);
    snapshotsRef.current = next;

    for (const item of accepted) {
      if (item.status === "ok") {
        successfulSnapshotVersions.current.set(item.provider, (successfulSnapshotVersions.current.get(item.provider) ?? 0) + 1);
      }
      recordDailyUsage(item);
      const nextPrimary = item.shortWindow?.remainingPercent;
      const previous = previousPrimary.current.get(item.provider);
      if (nextPrimary !== undefined && previous !== undefined && nextPrimary < previous) {
        setConsumingProviders((current) => new Set(current).add(item.provider));
        const oldTimer = consumptionTimers.current.get(item.provider);
        if (oldTimer !== undefined) window.clearTimeout(oldTimer);
        const timer = window.setTimeout(() => {
          setConsumingProviders((current) => { const next = new Set(current); next.delete(item.provider); return next; });
          consumptionTimers.current.delete(item.provider);
        }, 5 * 60_000);
        consumptionTimers.current.set(item.provider, timer);
      }
      if (nextPrimary !== undefined) previousPrimary.current.set(item.provider, nextPrimary);
    }
    const hasFailure = next.some((item) => item.status !== "ok");
    if (effectiveMode === "full") failures.current = hasFailure ? failures.current + 1 : 0;
    else failures.current = hasFailure ? Math.max(1, failures.current) : 0;
    setSnapshots(next);
    return accepted;
  }, []);

  const refresh = useCallback(async (force = false) => {
    const versionsAtStart = new Map(successfulSnapshotVersions.current);
    try {
      const values = await fetchSnapshots(force);
      const accepted = values.filter((item) => item.status === "ok"
        || (successfulSnapshotVersions.current.get(item.provider) ?? 0) === (versionsAtStart.get(item.provider) ?? 0));
      const applied = accepted.length > 0
        ? applySnapshots(accepted, accepted.length === values.length ? "full" : "partial")
        : [];
      const successful = applied.filter((item) => item.status === "ok");
      if (successful.length > 0) void broadcastSnapshots(successful).catch(() => undefined);
    } catch {
      setSnapshots((current) => {
        if (current.length === 0) {
          failures.current += 1;
          const next = [{ provider: "codex", displayName: "CODEX", plan: null, shortWindow: null, weeklyWindow: null, resetCredits: null, resetCreditExpiresAt: [], updatedAt: new Date().toISOString(), status: "unavailable", message: "Quota is temporarily unavailable. It will retry automatically." } satisfies ProviderSnapshot];
          snapshotsRef.current = next;
          return next;
        }
        let degraded = false;
        const next = current.map((item) => {
          const changedSinceStart = (successfulSnapshotVersions.current.get(item.provider) ?? 0) !== (versionsAtStart.get(item.provider) ?? 0);
          if (changedSinceStart) return item;
          degraded = true;
          return { ...item, status: "stale" as const, message: "Refresh failed. Please try again later." };
        });
        if (degraded) failures.current += 1;
        snapshotsRef.current = next;
        return next;
      });
    }
  }, [applySnapshots]);

  useEffect(() => {
    void getPreferences().then((value) => setPreferences({ ...DEFAULT_PREFS, ...value, language: normalizeLanguage(value.language) })).catch(() => setOperationError("Unable to read settings. Defaults are in use."));
    return () => {
      for (const timer of consumptionTimers.current.values()) window.clearTimeout(timer);
      consumptionTimers.current.clear();
      if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current);
    };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: () => void = () => {};
    void listenDesktopEvents({
      onPreferences: (value) => setPreferences({ ...DEFAULT_PREFS, ...value, language: normalizeLanguage(value.language) }),
      onRefresh: () => void refresh(true),
      onUpdate: () => checkUpdate(true),
      onSnapshots: (values) => applySnapshots(values, "partial"),
      onVoice: (value) => {
        setVoiceEvent(value);
        if (value.finalText) {
          if (!isTrayPanel) recordVoiceText(value.finalText);
          window.setTimeout(() => setVoiceRevision((revision) => revision + 1), 0);
        }
        if (value.message) setOperationError(value.message);
      },
    }).then((value) => {
      if (cancelled) value();
      else {
        cleanup = value;
        void refresh(true);
      }
    }).catch(() => {
      if (!cancelled) {
        setOperationError("Desktop event listener failed to start.");
        void refresh(true);
      }
    });
    return () => { cancelled = true; cleanup(); };
  }, [applySnapshots, checkUpdate, isTrayPanel, refresh]);

  useEffect(() => {
    if (isTrayPanel) return;
    setVoiceEvent((current) => ({ ...current, status: preferences.voiceEnabled ? "starting" : "disabled", level: 0 }));
    void (preferences.voiceEnabled ? stopVoice().then(() => startVoice()) : stopVoice())
      .catch(() => setOperationError(preferences.voiceEnabled ? "语音模式启动失败。" : "语音模式停止失败。"));
  }, [isTrayPanel, preferences.voiceEnabled, preferences.voiceInputDevice, preferences.voiceSensitivity]);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    if (isTrayPanel) return;
    let cancelled = false;
    let dispose: (() => Promise<void>) | undefined;
    void registerVoiceShortcut(preferences.voiceShortcut, () => {
      const previous = preferencesRef.current;
      const next = { ...previous, voiceEnabled: !previous.voiceEnabled };
      preferencesRef.current = next;
      setPreferences(next);
      setOperationError(null);
      void updatePreferences(next).catch(() => {
        preferencesRef.current = previous;
        setPreferences(previous);
        setOperationError("语音快捷键状态保存失败。");
      });
    }).then((cleanup) => { if (cancelled) void cleanup(); else dispose = cleanup; })
      .catch(() => { if (!cancelled) setOperationError(`快捷键 ${preferences.voiceShortcut} 已被占用，请在设置中更换。`); });
    return () => { cancelled = true; if (dispose) void dispose(); };
  }, [isTrayPanel, preferences.voiceShortcut]);

  useEffect(() => {
    if (isTrayPanel) return;
    const timer = window.setTimeout(() => checkUpdate(false), 12_000);
    return () => window.clearTimeout(timer);
  }, [checkUpdate, isTrayPanel]);

  const refreshMs = useMemo(() => {
    const backoff = failures.current === 0 ? 5 * 60_000 : Math.min(30 * 60_000, 30_000 * 2 ** (failures.current - 1));
    if (failures.current === 0 && snapshots.some((item) => item.status === "ok" && needsFastRefresh(item))) return 60_000;
    return backoff;
  }, [snapshots]);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), refreshMs);
    return () => window.clearInterval(id);
  }, [refresh, refreshMs]);

  useEffect(() => {
    const refreshWhenActive = () => { if (document.visibilityState === "visible") void refresh(true); };
    window.addEventListener("focus", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);
    return () => {
      window.removeEventListener("focus", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
    };
  }, [refresh]);

  useEffect(() => {
    if (hovered || preferences.pinnedProvider || snapshots.length < 2) return;
    const id = window.setInterval(() => setActiveIndex((value) => (value + 1) % snapshots.length), preferences.autoRotateSeconds * 1000);
    return () => window.clearInterval(id);
  }, [hovered, preferences.autoRotateSeconds, preferences.pinnedProvider, snapshots.length]);

  const current = preferences.pinnedProvider
    ? snapshots.find((item) => item.provider === preferences.pinnedProvider) ?? snapshots[0]
    : snapshots[activeIndex % Math.max(1, snapshots.length)];

  const savePreferences = useCallback((next: WidgetPreferences) => {
    const previous = preferences;
    preferencesRef.current = next;
    setPreferences(next);
    setOperationError(null);
    void updatePreferences(next).catch(() => { preferencesRef.current = previous; setPreferences(previous); setOperationError("Settings could not be saved. Previous state restored."); });
  }, [preferences]);

  const handleHover = useCallback((value: boolean) => {
    if (collapseTimer.current !== null) {
      window.clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
    setHovered(value);
    if (!value && preferences.stayExpanded) return;
    if (value) void refresh(true);
    if (value) {
      const sequence = ++hoverSequence.current;
      void setWidgetExpanded(true)
        .then(() => { if (hoverSequence.current === sequence) setCompact(false); })
        .catch(() => {
          setCompact(false);
          setOperationError("Widget expand failed.");
        });
      return;
    }
    const sequence = ++hoverSequence.current;
    collapseTimer.current = window.setTimeout(() => {
      if (hoverSequence.current !== sequence) return;
      setCompact(true);
      void setWidgetExpanded(false).catch(() => setOperationError("Widget collapse failed."));
    }, 180);
  }, [preferences.stayExpanded, refresh]);

  if (!current) return <div className={isTrayPanel ? "tray-panel tray-panel--loading" : "loading-orb"} aria-label={t.loadingQuota}><span /><span /><span /></div>;

  if (isTrayPanel) {
    return (
      <TrayPanel
        snapshot={current}
        preferences={preferences}
        onRefresh={() => void refresh(true)}
        onToggleWidget={() => toggleFloatingWidget()}
        onTogglePositionLock={() => setWidgetPositionLocked(!preferences.positionLocked).then((value) => setPreferences({ ...DEFAULT_PREFS, ...value }))}
        onResizeWidget={(larger) => resizeFloatingWidget(larger).then((value) => setPreferences({ ...DEFAULT_PREFS, ...value }))}
        onPanelColorChange={(color) => {
          const next = withPanelAccentColor(preferences, color);
          return updatePreferences(next).then(() => setPreferences(next));
        }}
        onSkinChange={(widgetStyle) => {
          const next = withWidgetStyle(preferences, widgetStyle);
          return updatePreferences(next).then(() => setPreferences(next));
        }}
        voiceEvent={voiceEvent}
        voiceRevision={voiceRevision}
        onVoicePreferencesChange={(voiceEnabled, voiceShortcut, voiceInputDevice, voiceSensitivity) => savePreferences({ ...preferences, voiceEnabled, voiceShortcut, voiceInputDevice, voiceSensitivity })}
        onScreenshotPreferencesChange={(screenshotShortcut, screenshotFolder) => savePreferences({ ...preferences, screenshotShortcut, screenshotFolder })}
      />
    );
  }

  return <QuotaOrb snapshot={current} language={language} positionLocked={preferences.positionLocked} widgetSize={preferences.widgetSize} accentColor={preferences.accentColor} widgetStyle={preferences.widgetStyle} voiceEvent={voiceEvent} onDrag={() => startDragging()} onHover={(value) => { setHovered(value); if (value && (current.status === "unavailable" || current.status === "stale")) void refresh(true); }} onOpenPanel={() => togglePanelFromWidget()} />;
}
