import {
  ArrowClockwise,
  CalendarBlank,
  Eye,
  EyeSlash,
  Minus,
  Palette,
  Plus,
  PushPin,
  TShirt,
} from "@phosphor-icons/react";
import { memo, type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { getUsageCalendar, recordTokenUsage, recordUsage, tokenHeatLevel, visibleTokenPeak } from "../lib/usageHistory";
import { getTodayUsagePercent, recordDailyUsage } from "../lib/dailyUsage";
import { clampPercent } from "../lib/format";
import { normalizeLanguage } from "../lib/i18n";
import { finishPanelResize, startPanelResize, type PanelResizeDirection } from "../lib/bridge";
import { isDarkPanelColor, panelAccentColor } from "../lib/skin";
import { formatEstimatedCost, nextCostCurrency, type CostCurrency } from "../lib/currency";
import { nextUsageRange, selectUsageRange, type UsageRange } from "../lib/usageRange";
import type { ProviderSnapshot, TokenBreakdown, WidgetPreferences, WidgetStyle } from "../types";

interface Props {
  snapshot: ProviderSnapshot;
  preferences: WidgetPreferences;
  onRefresh: () => void;
  onToggleWidget: () => Promise<boolean>;
  onTogglePositionLock: () => Promise<void>;
  onResizeWidget: (larger: boolean) => Promise<void>;
  onPanelColorChange: (color: string) => Promise<void>;
  onSkinChange: (widgetStyle: WidgetStyle) => Promise<void>;
}

const WEEKDAYS_ZH = ["一", "二", "三", "四", "五", "六", "日"];
const WEEKDAYS_EN = ["M", "T", "W", "T", "F", "S", "S"];
const MEMBERSHIP_EXPIRY_KEY = "quota-float:membership-expiry";
const COST_CURRENCY_KEY = "quota-float:cost-currency";
const WEEKLY_TOKEN_TARGET = 20_000_000_000;
const RESIZE_HANDLES: Array<{ direction: PanelResizeDirection; className: string }> = [
  { direction: "North", className: "north" },
  { direction: "East", className: "east" },
  { direction: "South", className: "south" },
  { direction: "West", className: "west" },
  { direction: "NorthEast", className: "north-east" },
  { direction: "SouthEast", className: "south-east" },
  { direction: "SouthWest", className: "south-west" },
  { direction: "NorthWest", className: "north-west" },
];
const EMPTY_BREAKDOWN: TokenBreakdown = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
  calls: 0,
  estimatedCostUsd: 0,
};

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(1)}B`;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return Math.round(tokens).toLocaleString();
}

function heatLevel(value: number | null, tokens: number | null, tokenReference: number): number {
  if (tokens !== null) return tokenHeatLevel(tokens, tokenReference);
  if (value === null || value <= 0) return 0;
  const percent = clampPercent(value);
  if (percent < 20) return 1;
  if (percent < 40) return 2;
  if (percent < 65) return 3;
  return 4;
}

export const TrayPanel = memo(function TrayPanel({
  snapshot,
  preferences,
  onRefresh,
  onToggleWidget,
  onTogglePositionLock,
  onResizeWidget,
  onPanelColorChange,
  onSkinChange,
}: Props) {
  const language = normalizeLanguage(preferences.language);
  const zh = language === "zh-CN";
  const bubbleSkin = preferences.widgetStyle === "bubble";
  const panelAccent = panelAccentColor(preferences);
  const weeklyRemaining = snapshot.weeklyWindow
    ? clampPercent(snapshot.weeklyWindow.remainingPercent)
    : null;
  const [todayWeeklyPercent, setTodayWeeklyPercent] = useState(() => getTodayUsagePercent() ?? 0);
  const [widgetVisible, setWidgetVisible] = useState(true);
  const [usageRange, setUsageRange] = useState<UsageRange>("today");
  const [costCurrency, setCostCurrency] = useState<CostCurrency>(() => {
    try {
      return window.localStorage.getItem(COST_CURRENCY_KEY) === "USD" ? "USD" : "CNY";
    } catch {
      return "CNY";
    }
  });
  const [membershipExpiry, setMembershipExpiry] = useState(() => {
    try {
      return window.localStorage.getItem(MEMBERSHIP_EXPIRY_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const membershipDateInput = useRef<HTMLInputElement>(null);
  const panelColorInput = useRef<HTMLInputElement>(null);

  const localUsage = snapshot.localUsage;
  const localDaily = useMemo(
    () => localUsage?.daily.map((day) => ({ date: day.date, tokens: day.usage.totalTokens })) ?? null,
    [localUsage?.daily],
  );
  const profileDaily = snapshot.dailyTokenUsage ?? null;
  const historySource = profileDaily?.length ? profileDaily : localDaily;
  const history = useMemo(() => getUsageCalendar(historySource), [historySource]);
  const currentDate = localDateKey();
  const profileToday = profileDaily?.find((day) => day.date === currentDate)?.tokens ?? 0;
  const estimatedToday = WEEKLY_TOKEN_TARGET * todayWeeklyPercent / 100;
  const today = localUsage?.today ?? {
    ...EMPTY_BREAKDOWN,
    totalTokens: profileToday || estimatedToday,
  };
  const rangeSelection = useMemo(
    () => selectUsageRange(localUsage, usageRange),
    [localUsage, usageRange],
  );
  const selectedUsage = localUsage ? rangeSelection.breakdown : today;
  const chartRows = rangeSelection.chart;
  const maxChartTokens = Math.max(1, ...chartRows.map((row) => row.tokens));
  const heatReferenceTokens = visibleTokenPeak(history);
  const totalTokenCount = history.reduce((sum, day) => sum + (day.tokens ?? 0), 0);

  const composition = [
    { key: "input", label: zh ? "输入" : "Input" },
    { key: "cache", label: zh ? "缓存" : "Cache" },
    { key: "output", label: zh ? "输出" : "Output" },
    { key: "reasoning", label: zh ? "推理" : "Reasoning" },
  ];

  const updated = new Date(snapshot.updatedAt);
  const updatedLabel = Number.isNaN(updated.getTime())
    ? "--:--"
    : updated.toLocaleTimeString(zh ? "zh-CN" : "en", { hour: "2-digit", minute: "2-digit" });
  const membershipRenewal = useMemo(() => {
    if (!membershipExpiry) {
      return { dateLabel: zh ? "选择日期" : "Choose date", relativeLabel: "" };
    }
    const [year, month, day] = membershipExpiry.split("-").map(Number);
    const renewalDate = new Date(year, month - 1, day);
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const daysAway = Math.round((renewalDate.getTime() - todayDate.getTime()) / 86_400_000);
    const dateLabel = zh
      ? `${month}月${day}日`
      : renewalDate.toLocaleDateString("en", { month: "short", day: "numeric" });
    const relativeLabel = daysAway === 0
      ? (zh ? "今天" : "Today")
      : daysAway > 0
        ? (zh ? `${daysAway}天后` : `in ${daysAway}d`)
        : (zh ? `已过期${Math.abs(daysAway)}天` : `${Math.abs(daysAway)}d overdue`);
    return { dateLabel, relativeLabel };
  }, [membershipExpiry, zh]);

  useEffect(() => {
    recordUsage(snapshot);
    recordTokenUsage(historySource);
    setTodayWeeklyPercent(recordDailyUsage(snapshot) ?? 0);
  }, [historySource, snapshot]);

  useEffect(() => {
    const finishResize = () => finishPanelResize();
    window.addEventListener("mouseup", finishResize, true);
    window.addEventListener("pointercancel", finishResize, true);
    return () => {
      window.removeEventListener("mouseup", finishResize, true);
      window.removeEventListener("pointercancel", finishResize, true);
    };
  }, []);

  const updateMembershipExpiry = (value: string) => {
    setMembershipExpiry(value);
    try {
      if (value) window.localStorage.setItem(MEMBERSHIP_EXPIRY_KEY, value);
      else window.localStorage.removeItem(MEMBERSHIP_EXPIRY_KEY);
    } catch {
      // Keep the in-memory date when local storage is unavailable.
    }
  };

  const openMembershipDatePicker = () => {
    const input = membershipDateInput.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    try {
      input.showPicker();
    } catch {
      input.click();
    }
  };

  const openPanelColorPicker = () => {
    const input = panelColorInput.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    try {
      input.showPicker();
    } catch {
      input.click();
    }
  };

  const toggleCostCurrency = () => {
    const next = nextCostCurrency(costCurrency);
    setCostCurrency(next);
    try {
      window.localStorage.setItem(COST_CURRENCY_KEY, next);
    } catch {
      // Keep the in-memory currency when local storage is unavailable.
    }
  };

  const toggleUsageRange = () => setUsageRange((current) => nextUsageRange(current));
  const rangeTokenLabel = usageRange === "today"
    ? (zh ? "今日 Token" : "Today tokens")
    : usageRange === "7d"
      ? (zh ? "近7天 Token" : "7-day tokens")
      : (zh ? "近30天 Token" : "30-day tokens");
  const rangeCostLabel = usageRange === "today"
    ? (zh ? "今日花费" : "Today cost")
    : usageRange === "7d"
      ? (zh ? "近7天花费" : "7-day cost")
      : (zh ? "近30天花费" : "30-day cost");
  const rangeChartLabel = usageRange === "today"
    ? (zh ? "今日 Token 消耗" : "Today's token usage")
    : usageRange === "7d"
      ? (zh ? "近7天 Token 消耗" : "7-day token usage")
      : (zh ? "近30天 Token 消耗" : "30-day token usage");
  const rangeDetailLabel = usageRange === "today"
    ? (zh ? "今日按小时" : "Hourly today")
    : usageRange === "7d"
      ? (zh ? "最近7天按日" : "Last 7 days")
      : (zh ? "最近30天按日" : "Last 30 days");
  const formattedCost = formatEstimatedCost(
    selectedUsage.estimatedCostUsd,
    costCurrency,
    localUsage?.usdCnyRate,
  );

  return (
    <main
      className={`tray-panel tray-panel--skin-${preferences.widgetStyle}`}
      data-skin={preferences.widgetStyle}
      data-panel-tone={isDarkPanelColor(panelAccent) ? "dark" : "light"}
      style={{ "--theme-accent": panelAccent, "--panel-accent": panelAccent } as CSSProperties}
    >
      <div className="tray-panel__wash" aria-hidden="true" />
      {RESIZE_HANDLES.map((handle) => (
        <div
          key={handle.direction}
          className={`panel-resize-handle panel-resize-handle--${handle.className}`}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            void startPanelResize(handle.direction);
          }}
          aria-hidden="true"
        />
      ))}

      <header className="tray-panel__header">
        <div className="tray-brand">
          <span className={`tray-brand__mark${bubbleSkin ? " tray-brand__mark--bubble" : ""}`}>
            {bubbleSkin ? <i aria-hidden="true" /> : "W"}
          </span>
          <div>
            <strong>Token Bubble</strong>
            <small>{zh ? `刷新 ${updatedLabel}` : `Updated ${updatedLabel}`}</small>
          </div>
        </div>
        <div
          className="tray-reset"
          onClick={(event) => {
            if (event.target !== membershipDateInput.current) openMembershipDatePicker();
          }}
        >
          <button
            className="renewal-calendar-button"
            type="button"
            aria-label={zh ? "设置续费日期" : "Set renewal date"}
            title={zh ? "设置续费日期" : "Set renewal date"}
          >
            <CalendarBlank weight="duotone" />
          </button>
          <label className="membership-date">
            <span>{zh ? "下次续费" : "Next renewal"}</span>
            <strong className="membership-date__value">
              {membershipRenewal.dateLabel}
              {membershipRenewal.relativeLabel && <em> · {membershipRenewal.relativeLabel}</em>}
            </strong>
            <input
              ref={membershipDateInput}
              type="date"
              value={membershipExpiry}
              onInput={(event) => updateMembershipExpiry(event.currentTarget.value)}
              aria-label={zh ? "选择会员到期日期" : "Choose membership expiry date"}
            />
          </label>
        </div>
        <button
          className="tray-icon-button"
          type="button"
          onClick={onRefresh}
          aria-label={zh ? "立即刷新" : "Refresh now"}
          title={zh ? "立即刷新" : "Refresh now"}
        >
          <ArrowClockwise />
        </button>
      </header>

      <section className="tray-overview tray-surface">
        <div
          className="quota-ring"
          style={{ "--ring-value": `${weeklyRemaining === null ? 0 : weeklyRemaining * 3.6}deg` } as CSSProperties}
          role="progressbar"
          aria-label={zh ? "周额度剩余" : "Weekly quota remaining"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={weeklyRemaining ?? undefined}
        >
          <div>
            <strong>{weeklyRemaining ?? "--"}<sup>{weeklyRemaining === null ? "" : "%"}</sup></strong>
            <span>{zh ? "周额度剩余" : "Weekly left"}</span>
          </div>
        </div>
        <button
          type="button"
          className="overview-metric overview-metric--tokens overview-metric--range"
          onClick={toggleUsageRange}
          title={zh ? "点击切换今日、7天和30天" : "Switch today, 7 days, and 30 days"}
          aria-label={`${rangeTokenLabel} ${formatTokenCount(selectedUsage.totalTokens)}`}
        >
          <span>{rangeTokenLabel}</span>
          <strong>{formatTokenCount(selectedUsage.totalTokens)}</strong>
        </button>
        <div className="overview-metric overview-metric--cost">
          <button
            type="button"
            className="overview-metric__range-button"
            onClick={toggleUsageRange}
            title={zh ? "点击切换今日、7天和30天" : "Switch today, 7 days, and 30 days"}
            aria-label={rangeCostLabel}
          >
            {rangeCostLabel}
          </button>
          <button
            type="button"
            className={`overview-metric__currency-button${formattedCost.length >= 7 ? " is-compact" : ""}`}
            onClick={toggleCostCurrency}
            title={zh ? `点击切换人民币/美元 · 汇率日期 ${localUsage?.exchangeRateDate ?? "--"}` : `Toggle CNY/USD · FX date ${localUsage?.exchangeRateDate ?? "--"}`}
            aria-label={`${rangeCostLabel} ${formattedCost}. ${zh ? "切换人民币和美元" : "Toggle CNY and USD"}`}
          >
            <em>估算</em>
            <strong>{formattedCost}</strong>
          </button>
        </div>
        <button
          type="button"
          className="token-composition"
          onClick={toggleUsageRange}
          title={zh ? "点击切换今日、7天和30天" : "Switch today, 7 days, and 30 days"}
          aria-label={`${rangeTokenLabel} ${zh ? "构成" : "composition"}`}
        >
          <span className="token-composition__bar">
            {composition.map((item) => (
              <i
                key={item.key}
                className={`token-part token-part--${item.key}`}
              />
            ))}
          </span>
          <span className="token-composition__legend">
            {composition.map((item) => <span key={item.key} className={`token-label token-label--${item.key}`}>{item.label}</span>)}
          </span>
        </button>
      </section>

      <section className="tray-middle">
        <button
          type="button"
          className={`hourly-usage hourly-usage--${usageRange} tray-surface`}
          onClick={toggleUsageRange}
          title={zh ? "点击切换今日、7天和30天" : "Switch today, 7 days, and 30 days"}
          aria-label={`${rangeChartLabel} ${formatTokenCount(selectedUsage.totalTokens)}`}
        >
          <header>
            <div>
              <span>{rangeChartLabel}</span>
              <strong>{formatTokenCount(selectedUsage.totalTokens)}</strong>
              <small>{rangeDetailLabel} · {selectedUsage.calls} {zh ? "次调用" : "calls"}</small>
            </div>
          </header>
          <div
            className="hourly-chart"
            style={{ "--chart-columns": chartRows.length } as CSSProperties}
            aria-label={rangeChartLabel}
          >
            {chartRows.map((row, index) => {
              const labelStep = usageRange === "today" ? 6 : usageRange === "7d" ? 1 : 7;
              const showLabel = index % labelStep === 0 || index === chartRows.length - 1;
              return (
                <div className="hourly-bar" key={row.key} title={`${row.title} · ${formatTokenCount(row.tokens)}`}>
                  <i style={{ height: `${row.tokens === 0 ? 0 : Math.max(5, row.tokens / maxChartTokens * 100)}%` }} />
                  <span>{showLabel ? row.label : ""}</span>
                </div>
              );
            })}
          </div>
        </button>

        <aside className="widget-controls-card tray-surface" aria-label={zh ? "浮窗和皮肤控制" : "Widget and skin controls"}>
          <button
            type="button"
            className={widgetVisible ? "is-active" : ""}
            onClick={() => void onToggleWidget().then(setWidgetVisible)}
            title={zh ? "显示或隐藏浮窗" : "Show or hide widget"}
            aria-label={zh ? "显示或隐藏浮窗" : "Show or hide widget"}
          >
            {widgetVisible ? <Eye weight="duotone" /> : <EyeSlash weight="duotone" />}
          </button>
          <button
            type="button"
            className={preferences.positionLocked ? "is-active" : ""}
            onClick={() => void onTogglePositionLock()}
            title={zh ? "固定或取消固定浮窗" : "Pin or unpin widget"}
            aria-label={zh ? "固定或取消固定浮窗" : "Pin or unpin widget"}
          >
            <PushPin weight={preferences.positionLocked ? "fill" : "duotone"} />
          </button>
          <button
            type="button"
            onClick={() => void onResizeWidget(true)}
            disabled={preferences.widgetSize >= 100}
            title={zh ? "放大浮窗" : "Enlarge widget"}
            aria-label={zh ? "放大浮窗" : "Enlarge widget"}
          >
            <Plus weight="bold" />
          </button>
          <button
            type="button"
            onClick={() => void onResizeWidget(false)}
            disabled={preferences.widgetSize <= 52}
            title={zh ? "缩小浮窗" : "Shrink widget"}
            aria-label={zh ? "缩小浮窗" : "Shrink widget"}
          >
            <Minus weight="bold" />
          </button>
          <label
            className="panel-color-control"
            title={zh ? "调整当前面板颜色" : "Adjust current panel color"}
            aria-label={zh ? "调整当前面板颜色" : "Adjust current panel color"}
            role="button"
            tabIndex={0}
            onClick={(event) => {
              if (event.target === panelColorInput.current) return;
              event.preventDefault();
              openPanelColorPicker();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              openPanelColorPicker();
            }}
          >
            <Palette weight="duotone" />
            <input
              ref={panelColorInput}
              type="color"
              value={panelAccent}
              onInput={(event) => void onPanelColorChange(event.currentTarget.value)}
              aria-label={zh ? "选择当前面板颜色" : "Choose current panel color"}
            />
          </label>
          <button
            type="button"
            className="skin-switch-control"
            onClick={() => void onSkinChange(bubbleSkin ? "bottle" : "bubble")}
            title={bubbleSkin ? (zh ? "切换为平面面板和玻璃瓶浮窗" : "Switch to flat panel and bottle widget") : (zh ? "切换为肥皂泡面板和浮窗" : "Switch to soap-bubble panel and widget")}
            aria-label={bubbleSkin ? (zh ? "切换为平面皮肤" : "Switch to flat skin") : (zh ? "切换为肥皂泡皮肤" : "Switch to bubble skin")}
          >
            <TShirt weight={bubbleSkin ? "fill" : "duotone"} />
          </button>
        </aside>
      </section>

      <section className="usage-history tray-surface">
        <header>
          <strong>{zh ? "近 90 天用量" : "Last 90 days"}</strong>
          <span>{zh ? `缓存命中 ${localUsage?.cacheHitPercent.toFixed(0) ?? "--"}%` : `Cache hit ${localUsage?.cacheHitPercent.toFixed(0) ?? "--"}%`}</span>
        </header>
        <div className="heatmap-wrap">
          <div className="weekday-labels">
            {(zh ? WEEKDAYS_ZH : WEEKDAYS_EN).map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
          </div>
          <div className="usage-heatmap" aria-label={zh ? "近 90 天 Token 用量热力图" : "90 day token usage heatmap"}>
            {history.map((day) => (
              <i
                key={day.date}
                className={`heat-${heatLevel(day.usedPercent, day.tokens, heatReferenceTokens)}`}
                title={`${day.date}: ${day.tokens === null ? "--" : formatTokenCount(day.tokens)}`}
              />
            ))}
          </div>
        </div>
        <footer>
          <strong>{zh ? `合计 ${formatTokenCount(totalTokenCount)}` : `Total ${formatTokenCount(totalTokenCount)}`}</strong>
          <span>{zh ? "少" : "Less"}<i className="heat-1" /><i className="heat-2" /><i className="heat-3" /><i className="heat-4" />{zh ? "多" : "More"}</span>
        </footer>
      </section>
    </main>
  );
});
