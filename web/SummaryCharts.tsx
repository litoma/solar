import React, { useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type FlowSourceKey = "solar" | "battIn" | "buy" | "other";
export type FlowTargetKey = "use" | "battOut" | "sell" | "loss";

export interface DailyFlowEdge {
  source: FlowSourceKey;
  target: FlowTargetKey;
  kwh: number;
}

export interface DailyBalanceInput {
  solarToday: number;
  buyToday: number;
  useToday: number;
  sellToday: number;
  batteryChgKwh: number;
  batteryDischgKwh: number;
  flows?: DailyFlowEdge[];
}

export interface MonthlyTotalPoint {
  ym: string;
  label: string;
  hasData: boolean;
  solar: number | null;
  use: number | null;
  buy: number | null;
  sell: number | null;
  loss: number | null;
}

export interface MonthlyTotalsData {
  months: MonthlyTotalPoint[];
}

// 1ページ目と配色を統一 (半透明背景・ボーダー・テキスト色)
const COLOR_SOLAR_TEXT = "#fbdd84";
const COLOR_BUY = "#de92bc";
const COLOR_BUY_TEXT = "#ffaee0";
const COLOR_USE_TEXT = "#57f293";
const COLOR_SELL_TEXT = "#88cdff";
const COLOR_BATTERY_TEXT = "#d5cbf9";
const COLOR_LOSS_TEXT = "#b4b9c7";

interface NodeTheme {
  label: string;
  subLabel?: string;
  tooltipLabel: string;
  fill: string;
  fillHover: string;
  stroke: string;
  titleColor: string;
  subColor: string;
  valueColor: string;
  ribbonColor: string;
}

const NODE_THEMES: Record<FlowSourceKey | FlowTargetKey, NodeTheme> = {
  solar: {
    label: "SOLAR",
    tooltipLabel: "SOLAR",
    fill: "rgba(215, 189, 114, 0.22)",
    fillHover: "rgba(215, 189, 114, 0.34)",
    stroke: "#d7bd72",
    titleColor: "#fbdd84",
    subColor: "#c2b99f",
    valueColor: "#e4e4e4",
    ribbonColor: "#d7bd72",
  },
  battIn: {
    label: "BATTERY",
    subLabel: "DISCHARGING",
    tooltipLabel: "BATTERY (DISCHARGING)",
    fill: "rgba(191, 182, 224, 0.22)",
    fillHover: "rgba(191, 182, 224, 0.34)",
    stroke: "#bfb6e0",
    titleColor: "#d5cbf9",
    subColor: "#bdb6ce",
    valueColor: "#e4e4e4",
    ribbonColor: "#9b8ec7",
  },
  buy: {
    label: "BUY",
    tooltipLabel: "BUY",
    fill: "rgba(222, 146, 188, 0.22)",
    fillHover: "rgba(222, 146, 188, 0.34)",
    stroke: "#de92bc",
    titleColor: "#ffaee0",
    subColor: "#bda8b3",
    valueColor: "#e4e4e4",
    ribbonColor: "#de92bc",
  },
  other: {
    label: "OTHER",
    tooltipLabel: "OTHER",
    fill: "rgba(110, 115, 130, 0.22)",
    fillHover: "rgba(110, 115, 130, 0.34)",
    stroke: "#6e7382",
    titleColor: "#b4b9c7",
    subColor: "#9a9ea6",
    valueColor: "#e4e4e4",
    ribbonColor: "#6e7382",
  },
  use: {
    label: "USE",
    tooltipLabel: "USE",
    fill: "rgba(75, 199, 124, 0.22)",
    fillHover: "rgba(75, 199, 124, 0.34)",
    stroke: "#4bc77c",
    titleColor: "#57f293",
    subColor: "#a3c2ae",
    valueColor: "#e4e4e4",
    ribbonColor: "#4bc77c",
  },
  battOut: {
    label: "BATTERY",
    subLabel: "CHARGING",
    tooltipLabel: "BATTERY (CHARGING)",
    fill: "rgba(191, 182, 224, 0.22)",
    fillHover: "rgba(191, 182, 224, 0.34)",
    stroke: "#bfb6e0",
    titleColor: "#d5cbf9",
    subColor: "#bdb6ce",
    valueColor: "#e4e4e4",
    ribbonColor: "#9b8ec7",
  },
  sell: {
    label: "SELL",
    tooltipLabel: "SELL",
    fill: "rgba(116, 174, 222, 0.22)",
    fillHover: "rgba(116, 174, 222, 0.34)",
    stroke: "#74aede",
    titleColor: "#88cdff",
    subColor: "#a8b9c8",
    valueColor: "#e4e4e4",
    ribbonColor: "#74aede",
  },
  loss: {
    label: "LOSS",
    tooltipLabel: "LOSS",
    fill: "rgba(110, 115, 130, 0.22)",
    fillHover: "rgba(110, 115, 130, 0.34)",
    stroke: "#6e7382",
    titleColor: "#b4b9c7",
    subColor: "#9a9ea6",
    valueColor: "#e4e4e4",
    ribbonColor: "#6e7382",
  },
};

const SOURCE_ORDER: FlowSourceKey[] = ["solar", "battIn", "buy", "other"];
const TARGET_ORDER: FlowTargetKey[] = ["use", "battOut", "sell", "loss"];

const MONTH_LABELS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * INPUT列は左端のみ角丸・右端は直角、OUTPUT列は左端は直角・右端のみ角丸にするパスを生成する
 */
function sankeyNodePath(
  x: number,
  y: number,
  w: number,
  h: number,
  side: "left" | "right",
  r = 8,
): string {
  if (w <= 0 || h <= 0) return "";
  const rad = Math.min(r, w / 2, h / 2);
  if (side === "left") {
    return (
      `M ${x + rad} ${y} ` +
      `L ${x + w} ${y} ` +
      `L ${x + w} ${y + h} ` +
      `L ${x + rad} ${y + h} ` +
      `Q ${x} ${y + h} ${x} ${y + h - rad} ` +
      `L ${x} ${y + rad} ` +
      `Q ${x} ${y} ${x + rad} ${y} Z`
    );
  }
  return (
    `M ${x} ${y} ` +
    `L ${x + w - rad} ${y} ` +
    `Q ${x + w} ${y} ${x + w} ${y + rad} ` +
    `L ${x + w} ${y + h - rad} ` +
    `Q ${x + w} ${y + h} ${x + w - rad} ${y + h} ` +
    `L ${x} ${y + h} Z`
  );
}

/**
 * サーバー側未提供時のみのシンプルなフォールバック経路生成
 */
function buildFallbackFlows(balance: DailyBalanceInput): DailyFlowEdge[] {
  let solar = Math.max(0, round2(balance.solarToday));
  let battIn = Math.max(0, round2(balance.batteryDischgKwh));
  let buy = Math.max(0, round2(balance.buyToday));
  let use = Math.max(0, round2(balance.useToday));
  let battOut = Math.max(0, round2(balance.batteryChgKwh));
  let sell = Math.max(0, round2(balance.sellToday));

  const out: DailyFlowEdge[] = [];
  const push = (source: FlowSourceKey, target: FlowTargetKey, kwh: number) => {
    if (kwh > 0.004) out.push({ source, target, kwh });
  };

  const sSell = Math.min(solar, sell);
  solar -= sSell;
  sell -= sSell;
  push("solar", "sell", sSell);

  const sBatt = Math.min(solar, battOut);
  solar -= sBatt;
  battOut -= sBatt;
  push("solar", "battOut", sBatt);

  const bBatt = Math.min(buy, battOut);
  buy -= bBatt;
  battOut -= bBatt;
  push("buy", "battOut", bBatt);

  const sUse = Math.min(solar, use);
  solar -= sUse;
  use -= sUse;
  push("solar", "use", sUse);

  const biUse = Math.min(battIn, use);
  battIn -= biUse;
  use -= biUse;
  push("battIn", "use", biUse);

  const bUse = Math.min(buy, use);
  buy -= bUse;
  use -= bUse;
  push("buy", "use", bUse);

  push("solar", "loss", solar);
  push("battIn", "loss", battIn);
  push("buy", "loss", buy);

  const extraNeed = use + battOut + sell;
  if (extraNeed > 0.005) {
    push("other", "use", use);
    push("other", "battOut", battOut);
    push("other", "sell", sell);
  }
  return out;
}

interface SankeyNodeBox<K extends string> {
  key: K;
  val: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

function layoutColumn<K extends string>(
  items: Array<{ key: K; val: number }>,
  x: number,
  topY: number,
  plotH: number,
  w: number,
): SankeyNodeBox<K>[] {
  const active = items.filter((it) => it.val > 0.004);
  if (active.length === 0) return [];
  const gap = 8;
  const minH = 20;
  const availH = Math.max(active.length * minH, plotH - (active.length - 1) * gap);
  const sum = active.reduce((acc, it) => acc + it.val, 0);

  // 最小高さを確保しつつ全体が availH に収まるように伸縮する
  const heights = active.map((it) => (sum > 0 ? (it.val / sum) * availH : minH));
  let deficit = 0;
  let flexSum = 0;
  for (let i = 0; i < heights.length; i++) {
    if (heights[i] < minH) {
      deficit += minH - heights[i];
      heights[i] = minH;
    } else {
      flexSum += heights[i] - minH;
    }
  }
  if (deficit > 0 && flexSum > 0) {
    const shrink = Math.min(1, deficit / flexSum);
    for (let i = 0; i < heights.length; i++) {
      if (heights[i] > minH) {
        heights[i] -= (heights[i] - minH) * shrink;
      }
    }
  }

  const totalUsed =
    heights.reduce((acc, h) => acc + h, 0) + (active.length - 1) * gap;
  let curY = topY + Math.max(0, (plotH - totalUsed) / 2);
  return active.map((it, idx) => {
    const box: SankeyNodeBox<K> = {
      key: it.key,
      val: it.val,
      x,
      y: curY,
      w,
      h: heights[idx],
    };
    curY += heights[idx] + gap;
    return box;
  });
}

type HoverTarget =
  | { kind: "node"; side: "left" | "right"; key: FlowSourceKey | FlowTargetKey }
  | { kind: "edge"; source: FlowSourceKey; target: FlowTargetKey };

function useContainerWidth(
  ref: React.RefObject<HTMLDivElement | null>,
  fallback: number,
): number {
  const [width, setWidth] = useState(fallback);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 40) setWidth(Math.round(w));
    };
    update();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [ref]);

  return width;
}

function DailySankeyChart({
  balance,
  svgHeight,
}: {
  balance: DailyBalanceInput;
  svgHeight: number;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const boxWidth = useContainerWidth(wrapRef, 600);
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [anchorPos, setAnchorPos] = useState<{ x: number; y: number } | null>(null);

  const solar = Math.max(0, round2(balance.solarToday));
  const battIn = Math.max(0, round2(balance.batteryDischgKwh));
  const buy = Math.max(0, round2(balance.buyToday));
  const use = Math.max(0, round2(balance.useToday));
  const battOut = Math.max(0, round2(balance.batteryChgKwh));
  const sell = Math.max(0, round2(balance.sellToday));

  const rawIn = round2(solar + battIn + buy);
  const rawOut = round2(use + battOut + sell);
  const totalBalance = Math.max(rawIn, rawOut);
  const other = rawOut > rawIn + 0.005 ? round2(rawOut - rawIn) : 0;
  const loss = rawIn > rawOut + 0.005 ? round2(rawIn - rawOut) : 0;

  const edges =
    balance.flows && balance.flows.length > 0
      ? balance.flows.filter((e) => e.kwh > 0.004)
      : buildFallbackFlows(balance);

  const svgW = Math.max(260, boxWidth);
  const svgH = svgHeight;
  const headerY = 10;
  const plotTopY = 18;
  const plotH = svgH - plotTopY - 4;
  const padX = 2;
  const nodeW =
    svgW >= 520
      ? Math.min(180, Math.round(svgW * 0.27))
      : Math.min(135, Math.round(svgW * 0.4));
  const leftX = padX;
  const rightX = svgW - padX - nodeW;

  const leftNodes = layoutColumn(
    [
      { key: "solar" as FlowSourceKey, val: solar },
      { key: "battIn" as FlowSourceKey, val: battIn },
      { key: "buy" as FlowSourceKey, val: buy },
      { key: "other" as FlowSourceKey, val: other },
    ],
    leftX,
    plotTopY,
    plotH,
    nodeW,
  );
  const rightNodes = layoutColumn(
    [
      { key: "use" as FlowTargetKey, val: use },
      { key: "battOut" as FlowTargetKey, val: battOut },
      { key: "sell" as FlowTargetKey, val: sell },
      { key: "loss" as FlowTargetKey, val: loss },
    ],
    rightX,
    plotTopY,
    plotH,
    nodeW,
  );

  const leftMap = new Map(leftNodes.map((n) => [n.key, n]));
  const rightMap = new Map(rightNodes.map((n) => [n.key, n]));

  // 各ノードの発着オフセットを計算 (クロスを最小化するため相手列の表示順に整列)
  const srcOutCursor = new Map<FlowSourceKey, number>();
  const dstInCursor = new Map<FlowTargetKey, number>();
  const srcOutTotal = new Map<FlowSourceKey, number>();
  const dstInTotal = new Map<FlowTargetKey, number>();

  for (const l of leftNodes) {
    srcOutCursor.set(l.key, l.y);
    const sSum = edges
      .filter((e) => e.source === l.key)
      .reduce((acc, e) => acc + e.kwh, 0);
    srcOutTotal.set(l.key, sSum);
  }
  for (const r of rightNodes) {
    dstInCursor.set(r.key, r.y);
    const dSum = edges
      .filter((e) => e.target === r.key)
      .reduce((acc, e) => acc + e.kwh, 0);
    dstInTotal.set(r.key, dSum);
  }

  const orderedForSource = [...edges].sort((a, b) => {
    const sDiff = SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source);
    if (sDiff !== 0) return sDiff;
    return TARGET_ORDER.indexOf(a.target) - TARGET_ORDER.indexOf(b.target);
  });

  const srcSlice = new Map<string, { sy0: number; sy1: number }>();
  for (const e of orderedForSource) {
    const ln = leftMap.get(e.source);
    const sSum = srcOutTotal.get(e.source) ?? 0;
    if (!ln || sSum <= 0) continue;
    const sy0 = srcOutCursor.get(e.source) ?? ln.y;
    const h = (e.kwh / sSum) * ln.h;
    srcSlice.set(`${e.source}:${e.target}`, { sy0, sy1: sy0 + h });
    srcOutCursor.set(e.source, sy0 + h);
  }

  const orderedForTarget = [...edges].sort((a, b) => {
    const tDiff = TARGET_ORDER.indexOf(a.target) - TARGET_ORDER.indexOf(b.target);
    if (tDiff !== 0) return tDiff;
    return SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source);
  });

  const ribbons: Array<{
    source: FlowSourceKey;
    target: FlowTargetKey;
    kwh: number;
    sy0: number;
    sy1: number;
    ty0: number;
    ty1: number;
    d: string;
    midX: number;
    midY: number;
  }> = [];

  const x0 = leftX + nodeW;
  const x1 = rightX;
  const mx = (x0 + x1) / 2;

  for (const e of orderedForTarget) {
    const rn = rightMap.get(e.target);
    const dSum = dstInTotal.get(e.target) ?? 0;
    const sCoords = srcSlice.get(`${e.source}:${e.target}`);
    if (!rn || dSum <= 0 || !sCoords) continue;
    const ty0 = dstInCursor.get(e.target) ?? rn.y;
    const h = (e.kwh / dSum) * rn.h;
    const ty1 = ty0 + h;
    dstInCursor.set(e.target, ty1);

    const { sy0, sy1 } = sCoords;
    const d = `M ${x0},${sy0} C ${mx},${sy0} ${mx},${ty0} ${x1},${ty0} L ${x1},${ty1} C ${mx},${ty1} ${mx},${sy1} ${x0},${sy1} Z`;
    ribbons.push({
      source: e.source,
      target: e.target,
      kwh: e.kwh,
      sy0,
      sy1,
      ty0,
      ty1,
      d,
      midX: mx,
      midY: (sy0 + sy1 + ty0 + ty1) / 4,
    });
  }

  const isEdgeHighlighted = (r: { source: FlowSourceKey; target: FlowTargetKey }) => {
    if (!hover) return false;
    if (hover.kind === "edge") {
      return hover.source === r.source && hover.target === r.target;
    }
    return hover.side === "left" ? hover.key === r.source : hover.key === r.target;
  };

  const isNodeHighlighted = (side: "left" | "right", key: FlowSourceKey | FlowTargetKey) => {
    if (!hover) return false;
    if (hover.kind === "node") return hover.side === side && hover.key === key;
    return side === "left" ? hover.source === key : hover.target === key;
  };

  // ホバー中リボンを最前面に描画する
  const sortedRibbons = [...ribbons].sort(
    (a, b) => Number(isEdgeHighlighted(a)) - Number(isEdgeHighlighted(b)),
  );

  const renderNodeContent = (
    box: SankeyNodeBox<FlowSourceKey | FlowTargetKey>,
    theme: NodeTheme,
  ) => {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    if (theme.subLabel && box.h >= 46) {
      return (
        <text x={cx} textAnchor="middle" fontFamily="JetBrains Mono, monospace">
          <tspan x={cx} y={cy - 10} fill={theme.titleColor} fontSize={10.5} fontWeight={600}>
            {theme.label}
          </tspan>
          <tspan x={cx} dy={11} fill={theme.subColor} fontSize={8.5} fontWeight={500}>
            {theme.subLabel}
          </tspan>
          <tspan x={cx} dy={13} fill={theme.valueColor} fontSize={11} fontWeight={600}>
            {box.val.toFixed(2)}
            <tspan fill="#c4c7d0" fontSize={9.5} fontWeight={500}>
              {" kWh"}
            </tspan>
          </tspan>
        </text>
      );
    }
    if (box.h >= 30) {
      return (
        <text x={cx} textAnchor="middle" fontFamily="JetBrains Mono, monospace">
          <tspan x={cx} y={cy - 2} fill={theme.titleColor} fontSize={10.5} fontWeight={600}>
            {theme.label}
          </tspan>
          <tspan x={cx} dy={13} fill={theme.valueColor} fontSize={11} fontWeight={600}>
            {box.val.toFixed(2)}
            <tspan fill="#c4c7d0" fontSize={9.5} fontWeight={500}>
              {" kWh"}
            </tspan>
          </tspan>
        </text>
      );
    }
    return (
      <text
        x={cx}
        y={cy + 3.5}
        textAnchor="middle"
        fontSize={10}
        fontWeight={600}
        fontFamily="JetBrains Mono, monospace"
      >
        <tspan fill={theme.titleColor}>{theme.label}</tspan>
        <tspan fill={theme.valueColor}>{` ${box.val.toFixed(2)}`}</tspan>
        <tspan fill="#c4c7d0" fontSize={9} fontWeight={500}>
          {" kWh"}
        </tspan>
      </text>
    );
  };

  const renderTooltip = () => {
    if (!hover || !anchorPos) return null;
    const placeBelow = anchorPos.y < svgH * 0.45;
    const verticalStyle: React.CSSProperties = placeBelow
      ? { top: `${Math.min(svgH - 44, anchorPos.y + 12)}px` }
      : { bottom: `${Math.max(8, svgH - anchorPos.y + 12)}px` };

    let horizStyle: React.CSSProperties;
    if (svgW < 440) {
      horizStyle = { left: "50%", transform: "translateX(-50%)" };
    } else if (hover.kind === "node" && hover.side === "left") {
      horizStyle = { left: `${leftX + nodeW + 10}px` };
    } else if (hover.kind === "node" && hover.side === "right") {
      horizStyle = { right: `${svgW - rightX + 10}px` };
    } else {
      horizStyle = { left: "50%", transform: "translateX(-50%)" };
    }

    if (hover.kind === "edge") {
      const sTheme = NODE_THEMES[hover.source];
      const tTheme = NODE_THEMES[hover.target];
      const edge = edges.find(
        (e) => e.source === hover.source && e.target === hover.target,
      );
      if (!edge) return null;
      const pct = totalBalance > 0 ? Math.round((edge.kwh / totalBalance) * 100) : 0;
      return (
        <div className="summary-sankey-tooltip" style={{ ...horizStyle, ...verticalStyle }}>
          <div className="sim-tooltip">
            <div className="sim-tooltip-title">
              <span style={{ color: sTheme.titleColor }}>{sTheme.tooltipLabel}</span>
              <span style={{ color: "#9a9ea6" }}>→</span>
              <span style={{ color: tTheme.titleColor }}>{tTheme.tooltipLabel}</span>
            </div>
            <div className="sim-tooltip-row">
              <span className="sim-tooltip-label">FLOW:</span>
              <span>
                {edge.kwh.toFixed(2)} kWh ({pct}%)
              </span>
            </div>
          </div>
        </div>
      );
    }

    const theme = NODE_THEMES[hover.key];
    const nodeBox =
      hover.side === "left"
        ? leftMap.get(hover.key as FlowSourceKey)
        : rightMap.get(hover.key as FlowTargetKey);
    const totalVal = nodeBox?.val ?? 0;
    const related =
      hover.side === "left"
        ? edges
          .filter((e) => e.source === hover.key)
          .sort((a, b) => b.kwh - a.kwh)
        : edges
          .filter((e) => e.target === hover.key)
          .sort((a, b) => b.kwh - a.kwh);

    return (
      <div className="summary-sankey-tooltip" style={{ ...horizStyle, ...verticalStyle }}>
        <div className="sim-tooltip">
          <div className="sim-tooltip-title" style={{ color: theme.titleColor }}>
            {theme.tooltipLabel}
          </div>
          {related.map((e) => {
            const peerKey = hover.side === "left" ? e.target : e.source;
            const peer = NODE_THEMES[peerKey];
            const pct = totalVal > 0 ? Math.round((e.kwh / totalVal) * 100) : 0;
            return (
              <div key={`${e.source}-${e.target}`} className="sim-tooltip-row">
                <span className="sim-tooltip-label" style={{ color: peer.titleColor }}>
                  {hover.side === "left" ? `→ ${peer.tooltipLabel}:` : `${peer.tooltipLabel} →:`}
                </span>
                <span>
                  {e.kwh.toFixed(2)} kWh ({pct}%)
                </span>
              </div>
            );
          })}
          <div className="sim-tooltip-row summary-tooltip-total">
            <span className="sim-tooltip-label">TOTAL:</span>
            <span>{totalVal.toFixed(2)} kWh</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={wrapRef}
      className="summary-sankey-wrap"
      onMouseLeave={() => {
        setHover(null);
        setAnchorPos(null);
      }}
      onClick={() => {
        setHover(null);
        setAnchorPos(null);
      }}
    >
      <svg
        className="summary-sankey-svg"
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        role="img"
        aria-label="Daily Input Output Sankey Diagram"
      >
        <defs>
          {ribbons.map((r) => (
            <linearGradient
              key={`grad-${r.source}-${r.target}`}
              id={`sankey-grad-${r.source}-${r.target}`}
              x1="0%"
              y1="0%"
              x2="100%"
              y2="0%"
            >
              <stop offset="0%" stopColor={NODE_THEMES[r.source].ribbonColor} />
              <stop offset="100%" stopColor={NODE_THEMES[r.target].ribbonColor} />
            </linearGradient>
          ))}
        </defs>

        <text
          x={leftX + nodeW / 2}
          y={headerY}
          textAnchor="middle"
          fill="#9c9ea6"
          fontSize={10.5}
          letterSpacing="0.14em"
          fontFamily="JetBrains Mono, monospace"
        >
          INPUT
        </text>
        <text
          x={rightX + nodeW / 2}
          y={headerY}
          textAnchor="middle"
          fill="#9c9ea6"
          fontSize={10.5}
          letterSpacing="0.14em"
          fontFamily="JetBrains Mono, monospace"
        >
          OUTPUT
        </text>

        {totalBalance <= 0.005 ? (
          <text
            x={svgW / 2}
            y={svgH / 2 + 6}
            textAnchor="middle"
            fill="#8e929e"
            fontSize={12}
            fontFamily="JetBrains Mono, monospace"
          >
            0.00 kWh
          </text>
        ) : (
          <>
            <g>
              {sortedRibbons.map((r) => {
                const hi = isEdgeHighlighted(r);
                const dimmed = hover !== null && !hi;
                return (
                  <path
                    key={`ribbon-${r.source}-${r.target}`}
                    d={r.d}
                    fill={`url(#sankey-grad-${r.source}-${r.target})`}
                    fillOpacity={hi ? 0.58 : dimmed ? 0.1 : 0.28}
                    stroke={hi ? NODE_THEMES[r.source].stroke : "none"}
                    strokeWidth={hi ? 0.8 : 0}
                    strokeOpacity={0.75}
                    style={{ cursor: "pointer", transition: "fill-opacity 0.16s ease" }}
                    onMouseEnter={() => {
                      setHover({ kind: "edge", source: r.source, target: r.target });
                      setAnchorPos({ x: r.midX, y: r.midY });
                    }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setHover({ kind: "edge", source: r.source, target: r.target });
                      setAnchorPos({ x: r.midX, y: r.midY });
                    }}
                  />
                );
              })}
            </g>

            <g>
              {leftNodes.map((n) => {
                const theme = NODE_THEMES[n.key];
                const hi = isNodeHighlighted("left", n.key);
                const dimmed = hover !== null && !hi;
                return (
                  <g
                    key={`left-${n.key}`}
                    style={{ cursor: "pointer", opacity: dimmed ? 0.55 : 1, transition: "opacity 0.16s ease" }}
                    onMouseEnter={() => {
                      setHover({ kind: "node", side: "left", key: n.key });
                      setAnchorPos({ x: n.x + n.w + 100, y: n.y + n.h / 2 });
                    }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setHover({ kind: "node", side: "left", key: n.key });
                      setAnchorPos({ x: n.x + n.w + 100, y: n.y + n.h / 2 });
                    }}
                  >
                    <path
                      d={sankeyNodePath(n.x, n.y, n.w, n.h, "left", 8)}
                      fill={hi ? theme.fillHover : theme.fill}
                      stroke={theme.stroke}
                      strokeWidth={1.5}
                    />
                    {renderNodeContent(n, theme)}
                  </g>
                );
              })}
            </g>

            <g>
              {rightNodes.map((n) => {
                const theme = NODE_THEMES[n.key];
                const hi = isNodeHighlighted("right", n.key);
                const dimmed = hover !== null && !hi;
                return (
                  <g
                    key={`right-${n.key}`}
                    style={{ cursor: "pointer", opacity: dimmed ? 0.55 : 1, transition: "opacity 0.16s ease" }}
                    onMouseEnter={() => {
                      setHover({ kind: "node", side: "right", key: n.key });
                      setAnchorPos({ x: n.x - 100, y: n.y + n.h / 2 });
                    }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setHover({ kind: "node", side: "right", key: n.key });
                      setAnchorPos({ x: n.x - 100, y: n.y + n.h / 2 });
                    }}
                  >
                    <path
                      d={sankeyNodePath(n.x, n.y, n.w, n.h, "right", 8)}
                      fill={hi ? theme.fillHover : theme.fill}
                      stroke={theme.stroke}
                      strokeWidth={1.5}
                    />
                    {renderNodeContent(n, theme)}
                  </g>
                );
              })}
            </g>
          </>
        )}
      </svg>
      {renderTooltip()}
    </div>
  );
}

interface MonthlyTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload?: MonthlyTotalPoint;
  }>;
}

function CustomMonthlyTooltip({ active, payload }: MonthlyTooltipProps) {
  if (!active || !payload || !payload.length || !payload[0].payload) return null;
  const pt = payload[0].payload;
  const fmt = (v: number | null) => (v !== null ? `${v.toFixed(1)} kWh` : "--");
  return (
    <div className="sim-tooltip">
      <div className="sim-tooltip-title">{pt.ym || pt.label}</div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label" style={{ color: COLOR_SOLAR_TEXT }}>
          SOLAR:
        </span>
        <span>{fmt(pt.solar)}</span>
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label" style={{ color: COLOR_USE_TEXT }}>
          USE:
        </span>
        <span>{fmt(pt.use)}</span>
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label" style={{ color: COLOR_BUY_TEXT }}>
          BUY:
        </span>
        <span>{fmt(pt.buy)}</span>
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label" style={{ color: COLOR_SELL_TEXT }}>
          SELL:
        </span>
        <span>{fmt(pt.sell)}</span>
      </div>
      <div className="sim-tooltip-row">
        <span className="sim-tooltip-label" style={{ color: COLOR_LOSS_TEXT }}>
          LOSS:
        </span>
        <span>{fmt(pt.loss)}</span>
      </div>
    </div>
  );
}

function SummaryCombinedView({
  balance,
  monthly,
  currentMonth,
}: {
  balance: DailyBalanceInput;
  monthly: MonthlyTotalsData;
  currentMonth: number;
}) {
  const subpageRef = useRef<HTMLDivElement | null>(null);
  const initialSubpageW =
    typeof window !== "undefined"
      ? window.innerWidth <= 680
        ? Math.max(290, window.innerWidth - 24)
        : Math.min(688, window.innerWidth - 32)
      : 688;
  const subpageW = useContainerWidth(subpageRef, initialSubpageW);
  const isMobile =
    typeof window !== "undefined" ? window.innerWidth <= 680 : subpageW < 580;
  // 1ページ目 (太陽SVG + INPUT/OUTPUT見出し + フローグリッド) の高さに2ページ目を揃える
  const page1H = Math.round(
    subpageW * (159 / 600) + 31 + (isMobile ? 444 : 500),
  );
  const availPlotH = Math.max(410, page1H - 130);
  const sankeyH = Math.round(availPlotH * 0.52);
  const areaH = availPlotH - sankeyH;

  // 直近1年間 (365日) 月別総量データ (SOLAR, USE, BUY, SELL, LOSS)
  const points = monthly.months || [];
  const currentLabel = MONTH_LABELS[(currentMonth ?? 1) - 1] ?? "";
  const hasCurrentMonthPoint =
    Boolean(currentLabel) && points.some((p) => p.label === currentLabel);

  const monthlyLegendItems = [
    { label: "SOLAR", color: COLOR_SOLAR_TEXT },
    { label: "USE", color: COLOR_USE_TEXT },
    { label: "BUY", color: COLOR_BUY },
    { label: "SELL", color: COLOR_SELL_TEXT },
    { label: "LOSS", color: COLOR_LOSS_TEXT },
  ];

  return (
    <div className="summary-subpage" ref={subpageRef}>
      {/* 上段グラフ: 本日の INPUT / OUTPUT サンキーダイアグラム */}
      <section className="summary-graph-block" aria-label="Daily Input Output">
        <div className="summary-subpage-head">
          <span className="summary-subpage-title">DAILY INPUT/OUTPUT</span>
        </div>

        <div className="sim-chart-box summary-chart-box">
          <DailySankeyChart balance={balance} svgHeight={sankeyH} />
        </div>
      </section>

      {/* 下段グラフ: 直近1年間(365日)の月別総量面グラフ */}
      <section className="summary-graph-block" aria-label="Monthly Total (Last 365D)">
        <div className="summary-subpage-head">
          <span className="summary-subpage-title">MONTHLY TOTAL (LAST 365D)</span>
        </div>

        <div className="sim-chart-box summary-chart-box">
          <div className="summary-chart-legend">
            {monthlyLegendItems.map((it) => (
              <span key={it.label} className="summary-legend-item">
                <span
                  className="summary-legend-line"
                  style={{ backgroundColor: it.color }}
                />
                <span style={{ color: it.color }}>{it.label}</span>
              </span>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={areaH}>
            <AreaChart
              data={points}
              margin={{ top: 20, right: 16, left: -10, bottom: 2 }}
            >
              <defs>
                <linearGradient id="grad-summary-solar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLOR_SOLAR_TEXT} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={COLOR_SOLAR_TEXT} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="grad-summary-use" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLOR_USE_TEXT} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={COLOR_USE_TEXT} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="grad-summary-buy" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLOR_BUY} stopOpacity={0.26} />
                  <stop offset="95%" stopColor={COLOR_BUY} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="grad-summary-sell" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLOR_SELL_TEXT} stopOpacity={0.24} />
                  <stop offset="95%" stopColor={COLOR_SELL_TEXT} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="grad-summary-loss" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLOR_LOSS_TEXT} stopOpacity={0.20} />
                  <stop offset="95%" stopColor={COLOR_LOSS_TEXT} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#383942" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                interval={0}
                tick={(tickProps: {
                  x?: number | string;
                  y?: number | string;
                  payload?: { value?: string };
                }) => {
                  const tx = Number(tickProps.x ?? 0);
                  const ty = Number(tickProps.y ?? 0);
                  const val = String(tickProps.payload?.value ?? "");
                  const isCurrent = val === currentLabel;
                  return (
                    <text
                      x={tx}
                      y={ty + 9}
                      textAnchor="middle"
                      fill={isCurrent ? COLOR_SOLAR_TEXT : "#b8bbc6"}
                      fontSize={10.5}
                      fontWeight={isCurrent ? 700 : 400}
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {val}
                    </text>
                  );
                }}
                axisLine={{ stroke: "#484a54" }}
                tickLine={false}
              />
              {hasCurrentMonthPoint ? (
                <ReferenceLine
                  x={currentLabel}
                  stroke={COLOR_SOLAR_TEXT}
                  strokeWidth={1}
                  strokeOpacity={0.75}
                />
              ) : null}
              <YAxis
                width={44}
                tick={{
                  fill: "#9a9ea6",
                  fontSize: 11,
                  fontFamily: "JetBrains Mono, monospace",
                }}
                axisLine={false}
                tickLine={false}
                label={(props: {
                  viewBox?: { x?: number; y?: number; width?: number };
                }) => {
                  const vbX = Number(props.viewBox?.x ?? 0);
                  const vbY = Number(props.viewBox?.y ?? 20);
                  const vbW = Number(props.viewBox?.width ?? 44);
                  return (
                    <text
                      x={vbX + vbW - 8}
                      y={vbY - 9}
                      textAnchor="end"
                      fill="#9a9ea6"
                      fontSize={10.5}
                      fontFamily="JetBrains Mono, monospace"
                    >
                      kWh
                    </text>
                  );
                }}
              />
              <Tooltip content={<CustomMonthlyTooltip />} />
              <Area
                type="monotone"
                name="SOLAR"
                dataKey="solar"
                stroke={COLOR_SOLAR_TEXT}
                strokeWidth={1.5}
                fill="url(#grad-summary-solar)"
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                name="USE"
                dataKey="use"
                stroke={COLOR_USE_TEXT}
                strokeWidth={1.5}
                fill="url(#grad-summary-use)"
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                name="BUY"
                dataKey="buy"
                stroke={COLOR_BUY}
                strokeWidth={1.5}
                fill="url(#grad-summary-buy)"
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                name="SELL"
                dataKey="sell"
                stroke={COLOR_SELL_TEXT}
                strokeWidth={1.5}
                fill="url(#grad-summary-sell)"
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                name="LOSS"
                dataKey="loss"
                stroke={COLOR_LOSS_TEXT}
                strokeWidth={1.5}
                fill="url(#grad-summary-loss)"
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

let summaryRoot: Root | null = null;

export function mountOrUpdateSummaryCharts(
  balance: DailyBalanceInput,
  monthly: MonthlyTotalsData,
  currentMonth: number,
): void {
  const container = document.getElementById("summary-charts-root");
  if (!container) return;
  if (!summaryRoot) {
    summaryRoot = createRoot(container);
  }
  summaryRoot.render(
    <SummaryCombinedView
      balance={balance}
      monthly={monthly}
      currentMonth={currentMonth}
    />,
  );
}
