import { ArrowClockwise, ArrowDown, ArrowUp, ArrowsInSimple, ArrowsOutSimple, ClockCounterClockwise, CloudSlash, Info, PushPin, PushPinSlash, SignIn, WarningCircle } from "@phosphor-icons/react";
import { memo, type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { clampPercent, formatDateTime, formatResetDate, formatResetTime, quotaTier } from "../lib/format";
import { copy, normalizeLanguage } from "../lib/i18n";
import { FIXED_BUBBLE_WIDGET_ACCENT } from "../lib/skin";
import type { Language, ProviderSnapshot, VoiceEvent, WidgetPreferences, WidgetStyle } from "../types";
import { ProviderMark } from "./ProviderMark";
import { CloudMistGauge } from "./CloudMistGauge";
import { LiquidGauge } from "./LiquidGauge";
import bubbleCloud from "../assets/bubble-material-reference.png";
import bubbleGlass from "../assets/bubble-empty-reference.png";
import bubbleRim from "../assets/bubble-rim-reference.png";

interface Props {
  snapshot: ProviderSnapshot;
  preferences: WidgetPreferences;
  providerCount: number;
  onPrevious: () => void;
  onNext: () => void;
  onTogglePin: () => void;
  onLock: () => void;
  onToggleStayExpanded: () => void;
  onDrag: () => void;
  onOpenPanel?: () => void;
  onHover: (hovered: boolean) => void;
  onRefresh?: () => void;
  isConsuming?: boolean;
  notice?: ReactNode;
  initialShowCreditTip?: boolean;
}

function StatusIcon({ status, expired = false }: { status: ProviderSnapshot["status"]; expired?: boolean }) {
  if (status === "signed_out") return <SignIn weight="duotone" />;
  if (status === "stale" || expired) return <ClockCounterClockwise weight="duotone" />;
  if (status === "unavailable") return <CloudSlash weight="duotone" />;
  return <WarningCircle weight="duotone" />;
}

function localizedBackendMessage(message: string | null, language: Language): string | null {
  if (!message) return null;
  if (language === "en") return message;
  const normalized = message.toLowerCase();
  if (normalized.includes("sign in") || normalized.includes("login")) return "Codex 登录已失效，请重新登录。";
  if (normalized.includes("rate limited")) return "请求过于频繁，将稍后自动重试。";
  if (normalized.includes("network")) return "网络不可用，将自动重试。";
  if (normalized.includes("format")) return "额度响应格式已变化。";
  if (normalized.includes("missing the 5h")) return "额度响应缺少 5 小时窗口。";
  if (normalized.includes("refresh is already running")) return "额度正在刷新，请稍候。";
  return message;
}

export const QuotaCard = memo(function QuotaCard({
  snapshot,
  preferences,
  providerCount,
  onPrevious,
  onNext,
  onTogglePin: _onTogglePin,
  onLock,
  onToggleStayExpanded,
  onDrag,
  onHover,
  onRefresh,
  isConsuming = false,
  notice = null,
  initialShowCreditTip = false,
}: Props) {
  const [showCreditTip, setShowCreditTip] = useState(initialShowCreditTip);
  const language = normalizeLanguage(preferences.language);
  const t = copy[language];
  const primary = snapshot.shortWindow ? clampPercent(snapshot.shortWindow.remainingPercent) : null;
  const weekly = snapshot.weeklyWindow ? clampPercent(snapshot.weeklyWindow.remainingPercent) : null;
  const displayPercent = primary ?? weekly;
  const displayWindow = snapshot.shortWindow ?? snapshot.weeklyWindow;
  const displayingWeeklyAsPrimary = primary === null && weekly !== null;
  const staleAge = Date.now() - new Date(snapshot.updatedAt).getTime();
  const staleExpired = snapshot.status === "stale" && staleAge > 30 * 60_000;
  const available = snapshot.status === "ok" || (snapshot.status === "stale" && !staleExpired);
  const tier = quotaTier(displayPercent);
  const indicatorState = isConsuming ? "active" : snapshot.status === "ok" ? "ok" : snapshot.status === "stale" ? "stale" : "error";
  const indicatorLabel = isConsuming
    ? t.active
    : snapshot.status === "ok"
      ? t.dataSynced
      : snapshot.status === "stale"
        ? t.dataStale
        : snapshot.status === "signed_out"
          ? t.notSignedIn
          : t.unavailableStatus;
  const message = localizedBackendMessage(snapshot.message, language);
  const creditExpirations = useMemo(() => (snapshot.resetCreditExpiresAt ?? []).map((value, index) => {
    return t.creditItem(index, formatDateTime(value, language));
  }), [language, snapshot.resetCreditExpiresAt, t]);

  return (
    <main
      className={`quota-card quota-card--${snapshot.status} quota-card--${tier}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onMouseDown={(event) => { if (event.button === 0) void onDrag(); }}
    >
      <div className="aurora" aria-hidden="true" />
      <span className="sr-only" aria-live="polite">{available && displayPercent !== null ? (displayingWeeklyAsPrimary ? t.weeklyAvailableLabel(displayPercent) : t.availableLabel(displayPercent)) : message}</span>
      {notice ? <div className="operation-notice" role="status">{notice}</div> : null}
      <header className="card-header">
        <div>
          <p className="eyebrow">{snapshot.displayName} · {snapshot.plan ?? t.accountFallback}</p>
          {snapshot.status !== "stale" ? <p className="updated">{displayingWeeklyAsPrimary ? t.weeklyShortRemaining : t.shortRemaining}</p> : null}
        </div>
        {!preferences.locked ? (
          <nav className="card-actions" aria-label={t.controls} onMouseDown={(event) => event.stopPropagation()}>
            {providerCount > 1 ? <button onClick={onPrevious} aria-label={t.servicePrevious}><ArrowUp /></button> : null}
            {providerCount > 1 ? <button onClick={onNext} aria-label={t.serviceNext}><ArrowDown /></button> : null}
            <span className={`usage-indicator usage-indicator--${indicatorState}`} role="status" aria-label={indicatorLabel} title={indicatorLabel}><i /></span>
            <button className={preferences.stayExpanded ? "expand-button expand-button--active" : "expand-button"} onClick={onToggleStayExpanded} aria-pressed={preferences.stayExpanded} aria-label={preferences.stayExpanded ? t.keepExpandedOff : t.keepExpandedOn} title={preferences.stayExpanded ? t.keepExpandedOff : t.keepExpandedOn}>
              {preferences.stayExpanded ? <ArrowsInSimple weight="bold" /> : <ArrowsOutSimple />}
            </button>
            <button className={preferences.alwaysOnTop ? "pin-button pin-button--active" : "pin-button"} onClick={onLock} aria-pressed={preferences.alwaysOnTop} aria-label={preferences.alwaysOnTop ? t.pinOff : t.pinOn} title={preferences.alwaysOnTop ? t.pinOff : t.pinOn}>
              {preferences.alwaysOnTop ? <PushPin weight="fill" /> : <PushPinSlash />}
            </button>
          </nav>
        ) : null}
      </header>

      {available && displayPercent !== null ? (
        <>
          <section className="primary-metric" aria-label={displayingWeeklyAsPrimary ? t.weeklyAvailableLabel(displayPercent) : t.availableLabel(displayPercent)}>
            <span>{displayPercent}</span><small>%</small>
          </section>
          <div className="progress" role="progressbar" aria-label={displayingWeeklyAsPrimary ? t.weeklyAvailableLabel(displayPercent) : t.availableLabel(displayPercent)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayPercent}>
            <span style={{ width: `${displayPercent}%` }} />
          </div>
          <p className="reset-time">{formatResetTime(displayWindow?.resetsAt ?? null, new Date(), language)}{displayWindow?.resetsAt ? ` · ${formatDateTime(displayWindow.resetsAt, language)}` : ""}</p>
          <footer className="card-footer">
            <div className="weekly-metric">
              {displayingWeeklyAsPrimary ? <p className="weekly-note"><Info weight="bold" aria-hidden="true" />{t.shortWindowUnavailable}</p> : <p>{t.weeklyUntil(formatResetDate(snapshot.weeklyWindow?.resetsAt ?? null, language))}</p>}
              <strong className={displayingWeeklyAsPrimary ? "weekly-value--unavailable" : undefined}>{displayingWeeklyAsPrimary ? "--" : weekly ?? "--"}<small>{displayingWeeklyAsPrimary || weekly === null ? "" : "%"}</small></strong>
              <div className="reset-credit-row" onMouseDown={(event) => event.stopPropagation()}>
                <span>{snapshot.resetCredits === null ? t.resetCreditUnknown : t.resetCredits(snapshot.resetCredits)}</span>
                {snapshot.resetCredits !== null && snapshot.resetCredits > 0 ? (
                  <button type="button" className="reset-credit-button" onClick={() => setShowCreditTip((value) => !value)} aria-expanded={showCreditTip} aria-label={t.view}>{t.view}</button>
                ) : null}
              </div>
              {showCreditTip ? (
                <div className="reset-credit-tip" role="status" onMouseDown={(event) => event.stopPropagation()}>
                  {creditExpirations.length > 0 ? creditExpirations.map((item) => <p key={item}>{item}</p>) : <p>{t.noCreditExpiration}</p>}
                </div>
              ) : null}
            </div>
            <ProviderMark />
          </footer>
        </>
      ) : (
        <section className="error-state" aria-live="polite">
          <div className="status-icon" aria-hidden="true"><StatusIcon status={snapshot.status} expired={staleExpired} /></div>
          <strong>{snapshot.status === "signed_out" ? t.signedInRequired : staleExpired ? t.staleExpired : t.temporarilyUnavailable}</strong>
          <p>{message ?? t.errorUnavailable}</p>
          {snapshot.status === "stale" ? (
            <button type="button" className="error-refresh-button" onMouseDown={(event) => event.stopPropagation()} onClick={onRefresh} disabled={!onRefresh} aria-label={t.refreshQuota}>
              <ArrowClockwise />
              <span>{t.refresh}</span>
            </button>
          ) : null}
        </section>
      )}
    </main>
  );
});

export const QuotaOrb = memo(function QuotaOrb({ snapshot, onDrag, onHover, onOpenPanel, language = "zh-CN", positionLocked = false, widgetSize = 68, accentColor = "#b97892", widgetStyle = "bubble", voiceEvent = { status: "disabled", level: 0 } }: Pick<Props, "snapshot" | "onDrag" | "onHover" | "onOpenPanel"> & { language?: Language; positionLocked?: boolean; widgetSize?: number; accentColor?: string; widgetStyle?: WidgetStyle; voiceEvent?: VoiceEvent }) {
  const [idle, setIdle] = useState(false);
  const [quotaMode, setQuotaMode] = useState<"codex" | "spark">("codex");
  const [switchPhase, setSwitchPhase] = useState<"idle" | "covering" | "revealing">("idle");
  const idleTimer = useRef<number | null>(null);
  const quotaModeRef = useRef<"codex" | "spark">("codex");
  const switchingRef = useRef(false);
  const switchTimers = useRef<number[]>([]);
  const autoReturnTimer = useRef<number | null>(null);
  const pendingClickTimer = useRef<number | null>(null);
  const pressRef = useRef<{ x: number; y: number; dragged: boolean } | null>(null);
  const activeLanguage = normalizeLanguage(language);
  const t = copy[activeLanguage];
  const primary = snapshot.shortWindow ? clampPercent(snapshot.shortWindow.remainingPercent) : null;
  const weekly = snapshot.weeklyWindow ? clampPercent(snapshot.weeklyWindow.remainingPercent) : null;
  const codexPercent = primary ?? weekly;
  const sparkPercent = snapshot.sparkWeeklyWindow ? clampPercent(snapshot.sparkWeeklyWindow.remainingPercent) : null;
  const showingSpark = quotaMode === "spark" && sparkPercent !== null;
  const displayPercent = showingSpark ? sparkPercent : codexPercent;
  const displayingWeeklyAsPrimary = primary === null && weekly !== null;
  const tier = quotaTier(displayPercent);
  const available = snapshot.status === "ok" && displayPercent !== null;
  const scale = Math.min(100, Math.max(52, widgetSize)) / 68;
  const widgetAccent = widgetStyle === "bubble" ? FIXED_BUBBLE_WIDGET_ACCENT : accentColor;
  const voiceStarting = voiceEvent.status === "starting";
  const voiceActive = voiceEvent.status === "listening" || voiceEvent.status === "recognizing";
  const centerActive = voiceStarting || voiceActive;
  const responsiveStyle = {
    "--orb-number-size": `${31 * scale}px`,
    "--orb-percent-size": `${12 * scale}px`,
    "--orb-percent-right": `${6.5 * scale}px`,
    "--orb-percent-bottom": `${9.5 * scale}px`,
    "--orb-number-offset": "0px",
    "--orb-badge-width": `${44 * scale}px`,
    "--orb-badge-height": `${17 * scale}px`,
    "--orb-badge-font-size": `${12 * scale}px`,
    "--orb-badge-line-height": `${12 * scale}px`,
    "--orb-visual-size": `${widgetSize}px`,
    "--bubble-cloud-top": `${displayPercent === null ? 100 : displayPercent >= 100 ? -10 : 100 - displayPercent * .94}%`,
    "--theme-accent": widgetAccent,
  } as CSSProperties;

  useEffect(() => {
    idleTimer.current = window.setTimeout(() => setIdle(true), 2000);
    return () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
      switchTimers.current.forEach((timer) => window.clearTimeout(timer));
      if (autoReturnTimer.current !== null) window.clearTimeout(autoReturnTimer.current);
      if (pendingClickTimer.current !== null) window.clearTimeout(pendingClickTimer.current);
    };
  }, []);

  useEffect(() => {
    if (sparkPercent !== null || quotaModeRef.current !== "spark") return;
    quotaModeRef.current = "codex";
    setQuotaMode("codex");
    setSwitchPhase("idle");
    switchingRef.current = false;
  }, [sparkPercent]);

  const runQuotaSwitch = (target: "codex" | "spark") => {
    if (widgetStyle !== "bubble" || sparkPercent === null || switchingRef.current || quotaModeRef.current === target) return;
    switchingRef.current = true;
    if (autoReturnTimer.current !== null) {
      window.clearTimeout(autoReturnTimer.current);
      autoReturnTimer.current = null;
    }
    setSwitchPhase("covering");
    const revealTimer = window.setTimeout(() => {
      quotaModeRef.current = target;
      setQuotaMode(target);
      setSwitchPhase("revealing");
    }, 340);
    const finishTimer = window.setTimeout(() => {
      switchingRef.current = false;
      setSwitchPhase("idle");
      if (target === "spark") {
        autoReturnTimer.current = window.setTimeout(() => runQuotaSwitch("codex"), 5_000);
      }
    }, 680);
    switchTimers.current.push(revealTimer, finishTimer);
  };

  const maybeStartDrag = (clientX: number, clientY: number) => {
    const press = pressRef.current;
    if (!press || press.dragged) return;
    if (Math.hypot(clientX - press.x, clientY - press.y) < 4) return;
    press.dragged = true;
    if (!positionLocked) void onDrag();
  };

  const handleMouseEnter = () => {
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    setIdle(false);
    onHover(true);
  };

  return (
    <main
      className={`quota-orb quota-orb--${widgetStyle} quota-card--${snapshot.status} quota-card--${tier}${displayingWeeklyAsPrimary ? " quota-orb--weekly" : ""}${showingSpark ? " quota-orb--spark" : ""}${idle ? " quota-orb--idle" : ""} quota-orb--voice-${voiceEvent.status}`}
      style={responsiveStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={(event) => {
        if (event.buttons === 1) maybeStartDrag(event.clientX, event.clientY);
        onHover(false);
      }}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        if (event.detail >= 2) {
          event.preventDefault();
          pressRef.current = null;
          if (pendingClickTimer.current !== null) {
            window.clearTimeout(pendingClickTimer.current);
            pendingClickTimer.current = null;
          }
          void onOpenPanel?.();
          return;
        }
        pressRef.current = { x: event.clientX, y: event.clientY, dragged: false };
      }}
      onMouseMove={(event) => maybeStartDrag(event.clientX, event.clientY)}
      onMouseUp={(event) => {
        if (event.button !== 0) return;
        const press = pressRef.current;
        pressRef.current = null;
        if (!press || press.dragged || event.detail >= 2) return;
        if (pendingClickTimer.current !== null) window.clearTimeout(pendingClickTimer.current);
        pendingClickTimer.current = window.setTimeout(() => {
          pendingClickTimer.current = null;
          runQuotaSwitch(quotaModeRef.current === "spark" ? "codex" : "spark");
        }, 260);
      }}
      aria-label={available ? (showingSpark ? (activeLanguage === "zh-CN" ? `Spark 本周剩余 ${displayPercent}%` : `Spark weekly quota remaining ${displayPercent}%`) : displayingWeeklyAsPrimary ? t.weeklyAvailableLabel(displayPercent!) : t.availableLabel(displayPercent!)) : localizedBackendMessage(snapshot.message, activeLanguage) ?? t.unavailableStatus}
    >
      <div className="aurora" aria-hidden="true" />
      {widgetStyle === "bubble" ? <img className="orb-bubble-glass" src={bubbleGlass} alt="" aria-hidden="true" /> : null}
      {widgetStyle === "bubble" ? <img className="orb-bubble-cloud" src={bubbleCloud} alt="" aria-hidden="true" /> : null}
      {widgetStyle === "bubble" ? <img className="orb-bubble-rim" src={bubbleRim} alt="" aria-hidden="true" /> : null}
      <div className="orb-balance">
        {available && widgetStyle === "bottle" ? <LiquidGauge level={displayPercent!} color={widgetAccent} /> : null}
        {available && widgetStyle === "bubble" ? <CloudMistGauge level={displayPercent!} /> : null}
        {available ? (
          <section className={`orb-metric${centerActive ? " is-hidden" : ""}`}>
            <span>{displayPercent}</span>
            <small>%</small>
          </section>
        ) : (
          <section className={`orb-unavailable${centerActive ? " is-hidden" : ""}`}>
            <StatusIcon status={snapshot.status} />
          </section>
        )}
        {widgetStyle === "bubble" ? <div className={`orb-switch-cloud orb-switch-cloud--${switchPhase}`} aria-hidden="true" /> : null}
      </div>
      <section className={`orb-voice${voiceActive ? " is-visible" : ""}`} aria-hidden={!voiceActive} aria-label={voiceEvent.status === "listening" ? "正在聆听" : "正在识别"}>
          <div className="orb-waveform" aria-hidden="true">
            {[.24, .42, .68, .5, 1, .7, .48, .58, .78, .52, .34, .22, .14].map((height, index) => (
              <i key={index} style={{ "--index": index, "--voice-bar": `${Math.max(.12, height * (.45 + voiceEvent.level * .75)) * 100}%` } as CSSProperties} />
            ))}
          </div>
      </section>
      <section className={`orb-starting${voiceStarting ? " is-visible" : ""}`} aria-hidden={!voiceStarting} aria-label="正在启动语音识别">
        <i /><i /><i />
      </section>
    </main>
  );
});
