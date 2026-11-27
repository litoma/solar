import React from "react";
import { createRoot, type Root } from "react-dom/client";

export interface PvMonthlyRecord {
  ym: string;
  month: number;
  label: string;
  hasData: boolean;
  pv1: number | null;
  pv2: number | null;
  pv3: number | null;
  pv4: number | null;
}

export type PvKey = "pv1" | "pv2" | "pv3" | "pv4";
export type DirectionKey = "east" | "west" | "south" | "north";

export interface PvSeriesItem {
  key: PvKey;
  label: string;
  color: string;
  fill: string;
  direction: DirectionKey;
  panelCount: number;
}

export interface AnnualPvBreakdown {
  pv1: number;
  pv2: number;
  pv3: number;
  pv4: number;
  total: number;
}

interface DirectionConfig {
  key: DirectionKey;
  label: string;
  color: string;
  textColor: string;
  fill: string;
  pvs: PvKey[];
}

// PV1〜4は3D屋根の蛍光ネオン配色と統一 (オレンジ・ピンク・黄緑・水色)
export const PV_SERIES: PvSeriesItem[] = [
  { key: "pv1", label: "PV1", color: "#ff7a18", fill: "rgba(255, 122, 24, 0.34)", direction: "west", panelCount: 5 },
  { key: "pv2", label: "PV2", color: "#ff3ca6", fill: "rgba(255, 60, 166, 0.34)", direction: "east", panelCount: 4 },
  { key: "pv3", label: "PV3", color: "#9eff14", fill: "rgba(158, 255, 20, 0.34)", direction: "west", panelCount: 3 },
  { key: "pv4", label: "PV4", color: "#00e5ff", fill: "rgba(0, 229, 255, 0.34)", direction: "north", panelCount: 3 },
];

const PV_MAP = new Map<PvKey, PvSeriesItem>(PV_SERIES.map((s) => [s.key, s]));

// 時計回りの並び順: 12時から 東(PV2) → 西(PV1, PV3) → 南(該当パネルなしのため0なら非表示) → 北(PV4)
// 外周リングの配色: 内側リング(PV1〜4)より一段濃い(暗い)同系色 / 中間色でコントラストを付ける
const DIRECTION_RING_ORDER: DirectionConfig[] = [
  {
    key: "east",
    label: "EAST",
    color: "#9e1c60",
    textColor: "#f472b6",
    fill: "rgba(104, 12, 60, 0.72)",
    pvs: ["pv2"],
  },
  {
    key: "west",
    label: "WEST",
    color: "#8f7812",
    textColor: "#f3cf4a",
    fill: "rgba(88, 74, 8, 0.74)",
    pvs: ["pv1", "pv3"],
  },
  {
    key: "south",
    label: "SOUTH",
    color: "#9a3412",
    textColor: "#fb923c",
    fill: "rgba(102, 38, 8, 0.72)",
    pvs: [],
  },
  {
    key: "north",
    label: "NORTH",
    color: "#0e7490",
    textColor: "#5ce1f6",
    fill: "rgba(6, 70, 90, 0.76)",
    pvs: ["pv4"],
  },
];

/**
 * 選択年の各月の PV1〜PV4 発電量を、月別実績トータル (solar_kwh) に比例配分して求める
 */
export function resolveMonthlyPvValues(
  pvRec: PvMonthlyRecord | undefined,
  monthlyActualKwh: number,
): { pv1: number; pv2: number; pv3: number; pv4: number } {
  const actualRaw = Math.max(0, monthlyActualKwh || 0);
  const r1 = Math.max(0, pvRec?.pv1 ?? 0);
  const r2 = Math.max(0, pvRec?.pv2 ?? 0);
  const r3 = Math.max(0, pvRec?.pv3 ?? 0);
  const r4 = Math.max(0, pvRec?.pv4 ?? 0);
  const rSum = r1 + r2 + r3 + r4;

  if (actualRaw > 0 && rSum > 0) {
    return {
      pv1: (actualRaw * r1) / rSum,
      pv2: (actualRaw * r2) / rSum,
      pv3: (actualRaw * r3) / rSum,
      pv4: (actualRaw * r4) / rSum,
    };
  }
  if (rSum > 0) {
    return { pv1: r1, pv2: r2, pv3: r3, pv4: r4 };
  }
  return { pv1: 0, pv2: 0, pv3: 0, pv4: 0 };
}

/**
 * 選択年の年間 PV1〜PV4 合計値および総発電量を算出する
 */
export function aggregateAnnualPvTotals(
  pvMonthly: PvMonthlyRecord[],
  monthlyActualKwh: Record<number, number> = {},
): AnnualPvBreakdown {
  const byMonth = new Map<number, PvMonthlyRecord>();
  for (const rec of pvMonthly) {
    byMonth.set(rec.month, rec);
  }

  let pv1 = 0;
  let pv2 = 0;
  let pv3 = 0;
  let pv4 = 0;
  for (let m = 1; m <= 12; m++) {
    const resolved = resolveMonthlyPvValues(
      byMonth.get(m),
      monthlyActualKwh[m] ?? 0,
    );
    pv1 += resolved.pv1;
    pv2 += resolved.pv2;
    pv3 += resolved.pv3;
    pv4 += resolved.pv4;
  }

  return {
    pv1,
    pv2,
    pv3,
    pv4,
    total: pv1 + pv2 + pv3 + pv4,
  };
}

interface InnerArcSlice {
  key: PvKey;
  label: string;
  direction: DirectionKey;
  directionLabel: string;
  panelCount: number;
  kwh: number;
  sharePct: number;
  dirSharePct: number;
  color: string;
  fill: string;
  startRad: number;
  endRad: number;
  midRad: number;
}

interface OuterArcSlice {
  key: DirectionKey;
  label: string;
  pvs: InnerArcSlice[];
  kwh: number;
  sharePct: number;
  color: string;
  textColor: string;
  fill: string;
  startRad: number;
  endRad: number;
  midRad: number;
}

type HoverTarget =
  | { kind: "pv"; key: PvKey; x: number; y: number }
  | { kind: "dir"; key: DirectionKey; x: number; y: number };

// 外側リングを太くし、グラフ表示領域を広げる (CENTER 0..56 / INNER 58..126 / OUTER 130..192)
const SVG_W = 440;
const SVG_H = 420;
const CX = 220;
const CY = 210;
const R_HOLE = 56;
const R1_IN = 58;
const R1_OUT = 126;
const R2_IN = 130;
const R2_OUT = 192;
const RING_GAP_PX = 2.6;
const START_RAD = -Math.PI / 2; // 12時方向から時計回り

/**
 * 極座標 (中心 CX, CY) から SVG 直交座標を求める
 */
function polarToCart(r: number, rad: number): { x: number; y: number } {
  return {
    x: CX + r * Math.cos(rad),
    y: CY + r * Math.sin(rad),
  };
}

/**
 * 内半径 rIn〜外半径 rOut・開始角〜終了角 のドーナツ扇形 SVG パスを生成する
 */
function describeAnnularSector(
  rIn: number,
  rOut: number,
  startRad: number,
  endRad: number,
  sliceCount: number,
): string {
  const span = endRad - startRad;
  if (span <= 0) return "";

  if (sliceCount <= 1 || span >= Math.PI * 1.999) {
    const o0 = polarToCart(rOut, startRad);
    const oMid = polarToCart(rOut, startRad + Math.PI);
    const i0 = polarToCart(rIn, startRad);
    const iMid = polarToCart(rIn, startRad + Math.PI);
    return (
      `M ${o0.x.toFixed(2)} ${o0.y.toFixed(2)} ` +
      `A ${rOut} ${rOut} 0 1 1 ${oMid.x.toFixed(2)} ${oMid.y.toFixed(2)} ` +
      `A ${rOut} ${rOut} 0 1 1 ${o0.x.toFixed(2)} ${o0.y.toFixed(2)} ` +
      `M ${i0.x.toFixed(2)} ${i0.y.toFixed(2)} ` +
      `A ${rIn} ${rIn} 0 1 0 ${iMid.x.toFixed(2)} ${iMid.y.toFixed(2)} ` +
      `A ${rIn} ${rIn} 0 1 0 ${i0.x.toFixed(2)} ${i0.y.toFixed(2)} Z`
    );
  }

  const daIn = Math.min(RING_GAP_PX / (2 * rIn), span * 0.25);
  const daOut = Math.min(RING_GAP_PX / (2 * rOut), span * 0.25);
  const a0Out = startRad + daOut;
  const a1Out = endRad - daOut;
  const a0In = startRad + daIn;
  const a1In = endRad - daIn;

  const p0Out = polarToCart(rOut, a0Out);
  const p1Out = polarToCart(rOut, a1Out);
  const p1In = polarToCart(rIn, a1In);
  const p0In = polarToCart(rIn, a0In);

  const largeArcOut = a1Out - a0Out > Math.PI ? 1 : 0;
  const largeArcIn = a1In - a0In > Math.PI ? 1 : 0;

  return (
    `M ${p0Out.x.toFixed(2)} ${p0Out.y.toFixed(2)} ` +
    `A ${rOut} ${rOut} 0 ${largeArcOut} 1 ${p1Out.x.toFixed(2)} ${p1Out.y.toFixed(2)} ` +
    `L ${p1In.x.toFixed(2)} ${p1In.y.toFixed(2)} ` +
    `A ${rIn} ${rIn} 0 ${largeArcIn} 0 ${p0In.x.toFixed(2)} ${p0In.y.toFixed(2)} Z`
  );
}

/**
 * 極小スライス用の外側引出しラベル座標を求める
 */
function computeCalloutAnchor(midRad: number, outerR: number): {
  lx1: number;
  ly1: number;
  lx2: number;
  ly2: number;
  tx: number;
  ty: number;
  textAnchor: "start" | "end" | "middle";
} {
  const cos = Math.cos(midRad);
  const pStart = polarToCart(outerR - 1, midRad);
  const pElbow = polarToCart(outerR + 12, midRad);
  if (Math.abs(cos) < 0.22) {
    return {
      lx1: pStart.x,
      ly1: pStart.y,
      lx2: pElbow.x,
      ly2: pElbow.y,
      tx: pElbow.x,
      ty: pElbow.y + (Math.sin(midRad) < 0 ? -9 : 11),
      textAnchor: "middle",
    };
  }
  const side = cos >= 0 ? 1 : -1;
  return {
    lx1: pStart.x,
    ly1: pStart.y,
    lx2: pElbow.x + side * 8,
    ly2: pElbow.y,
    tx: pElbow.x + side * 12,
    ty: pElbow.y,
    textAnchor: side > 0 ? "start" : "end",
  };
}

function buildRingSlices(annual: AnnualPvBreakdown): {
  innerSlices: InnerArcSlice[];
  outerSlices: OuterArcSlice[];
} {
  if (annual.total <= 0) {
    return { innerSlices: [], outerSlices: [] };
  }

  let cursor = START_RAD;
  const innerSlices: InnerArcSlice[] = [];
  const outerSlices: OuterArcSlice[] = [];

  for (const dir of DIRECTION_RING_ORDER) {
    const activePvs = dir.pvs
      .map((pvKey) => ({ pvKey, kwh: annual[pvKey], meta: PV_MAP.get(pvKey) }))
      .filter((item): item is { pvKey: PvKey; kwh: number; meta: PvSeriesItem } =>
        Boolean(item.meta) && item.kwh > 0,
      );
    const dirKwh = activePvs.reduce((sum, item) => sum + item.kwh, 0);
    // 南など該当パネル・発電量が 0 の方位は非表示
    if (dirKwh <= 0 || activePvs.length === 0) continue;

    const dirStart = cursor;
    const dirMembers: InnerArcSlice[] = [];

    for (const item of activePvs) {
      const spanRad = (item.kwh / annual.total) * Math.PI * 2;
      const pvStart = cursor;
      const pvEnd = cursor + spanRad;
      cursor = pvEnd;

      const innerSlice: InnerArcSlice = {
        key: item.pvKey,
        label: item.meta.label,
        direction: dir.key,
        directionLabel: dir.label,
        panelCount: item.meta.panelCount,
        kwh: item.kwh,
        sharePct: (item.kwh / annual.total) * 100,
        dirSharePct: dirKwh > 0 ? (item.kwh / dirKwh) * 100 : 0,
        color: item.meta.color,
        fill: item.meta.fill,
        startRad: pvStart,
        endRad: pvEnd,
        midRad: (pvStart + pvEnd) / 2,
      };
      dirMembers.push(innerSlice);
      innerSlices.push(innerSlice);
    }

    const dirEnd = cursor;
    outerSlices.push({
      key: dir.key,
      label: dir.label,
      pvs: dirMembers,
      kwh: dirKwh,
      sharePct: (dirKwh / annual.total) * 100,
      color: dir.color,
      textColor: dir.textColor,
      fill: dir.fill,
      startRad: dirStart,
      endRad: dirEnd,
      midRad: (dirStart + dirEnd) / 2,
    });
  }

  return { innerSlices, outerSlices };
}

function PvDonutChart({
  annual,
  selectedYear,
}: {
  annual: AnnualPvBreakdown;
  selectedYear: number;
}) {
  const [hover, setHover] = React.useState<HoverTarget | null>(null);
  const { innerSlices, outerSlices } = React.useMemo(
    () => buildRingSlices(annual),
    [annual],
  );

  const isInnerActive = (s: InnerArcSlice): boolean => {
    if (!hover) return false;
    if (hover.kind === "pv") return hover.key === s.key;
    return hover.key === s.direction;
  };

  const isOuterActive = (d: OuterArcSlice): boolean => {
    if (!hover) return false;
    if (hover.kind === "dir") return hover.key === d.key;
    const hoveredPv = PV_MAP.get(hover.key);
    return hoveredPv?.direction === d.key;
  };

  const hoveredInner =
    hover?.kind === "pv"
      ? innerSlices.find((s) => s.key === hover.key) ?? null
      : null;
  const hoveredOuter =
    hover?.kind === "dir"
      ? outerSlices.find((d) => d.key === hover.key) ?? null
      : null;

  const totalFontSize = annual.total >= 1000 ? 16 : 19;

  return (
    <div
      className="pv-donut-wrap"
      onMouseLeave={() => setHover(null)}
      onClick={() => setHover(null)}
    >
      <div className="pv-donut-svg-stage">
        <svg
          className="pv-donut-svg"
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          role="img"
          aria-label={`${selectedYear} Annual Generation by PV String and Roof Direction`}
        >
          {annual.total <= 0 ? (
            <>
              <circle
                cx={CX}
                cy={CY}
                r={(R1_IN + R2_OUT) / 2}
                fill="none"
                stroke="#30333d"
                strokeWidth={R2_OUT - R1_IN}
              />
              <circle
                cx={CX}
                cy={CY}
                r={R_HOLE - 2}
                fill="#24262d"
                stroke="#3f424c"
                strokeWidth={1.2}
              />
              <text
                x={CX}
                y={CY - 8}
                textAnchor="middle"
                fill="#d7bd72"
                fontSize={10.5}
                fontWeight={600}
                letterSpacing="0.08em"
                fontFamily="JetBrains Mono, monospace"
              >
                {selectedYear} ANNUAL
              </text>
              <text
                x={CX}
                y={CY + 12}
                textAnchor="middle"
                fill="#9397a5"
                fontSize={11.5}
                fontFamily="JetBrains Mono, monospace"
              >
                NO DATA
              </text>
            </>
          ) : (
            <>
              {/* 外側の円: 方位 (太めの幅にして方位名・%・kWhをすべて表示) */}
              <g className="pv-donut-outer-ring">
                {outerSlices.map((d) => {
                  const pathD = describeAnnularSector(
                    R2_IN,
                    R2_OUT,
                    d.startRad,
                    d.endRad,
                    outerSlices.length,
                  );
                  const active = isOuterActive(d);
                  const dimmed = Boolean(hover) && !active;
                  const rMid = (R2_IN + R2_OUT) / 2;
                  const arcLen = rMid * (d.endRad - d.startRad);
                  const isTiny = arcLen < 42;
                  const isCompact = arcLen < 68;
                  const labelPos = polarToCart(
                    isCompact ? rMid + 3 : rMid,
                    d.midRad,
                  );
                  const callout = isTiny
                    ? computeCalloutAnchor(d.midRad, R2_OUT)
                    : null;

                  return (
                    <g
                      key={d.key}
                      className={`pv-donut-slice${active ? " is-active" : ""}${dimmed ? " is-dimmed" : ""}`}
                      onMouseEnter={() =>
                        setHover({
                          kind: "dir",
                          key: d.key,
                          x: labelPos.x,
                          y: labelPos.y,
                        })
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        setHover((prev) =>
                          prev?.kind === "dir" && prev.key === d.key
                            ? null
                            : { kind: "dir", key: d.key, x: labelPos.x, y: labelPos.y },
                        );
                      }}
                    >
                      <path
                        d={pathD}
                        fill={d.fill}
                        fillRule="evenodd"
                        stroke={d.color}
                        strokeWidth={active ? 2.1 : 1.4}
                      />
                      {isTiny && callout ? (
                        <g className="pv-donut-callout">
                          <polyline
                            points={`${callout.lx1.toFixed(1)},${callout.ly1.toFixed(1)} ${callout.lx2.toFixed(1)},${callout.ly2.toFixed(1)}`}
                            fill="none"
                            stroke={d.color}
                            strokeWidth={1}
                            strokeOpacity={0.85}
                          />
                          <text
                            x={callout.tx}
                            y={callout.ty - 5}
                            textAnchor={callout.textAnchor}
                            dominantBaseline="central"
                            fill={d.textColor}
                            fontSize={10.5}
                            fontWeight={700}
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {d.label}
                          </text>
                          <text
                            x={callout.tx}
                            y={callout.ty + 7}
                            textAnchor={callout.textAnchor}
                            dominantBaseline="central"
                            fill="#eef0f6"
                            fontSize={10}
                            fontWeight={600}
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {d.sharePct.toFixed(1)}% · {d.kwh.toFixed(1)}kWh
                          </text>
                        </g>
                      ) : isCompact ? (
                        <g className="pv-donut-slice-label">
                          <text
                            x={labelPos.x}
                            y={labelPos.y - 6}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill="#ffffff"
                            fontSize={11.5}
                            fontWeight={700}
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {d.label}
                          </text>
                          <text
                            x={labelPos.x}
                            y={labelPos.y + 8}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill={d.textColor}
                            fontSize={10.5}
                            fontWeight={700}
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {d.sharePct.toFixed(1)}%
                          </text>
                        </g>
                      ) : (
                        <g className="pv-donut-slice-label">
                          <text
                            x={labelPos.x}
                            y={labelPos.y - 13.5}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill="#ffffff"
                            fontSize={12.5}
                            fontWeight={700}
                            letterSpacing="0.04em"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {d.label}
                          </text>
                          <text
                            x={labelPos.x}
                            y={labelPos.y + 0.5}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill={d.textColor}
                            fontSize={11.5}
                            fontWeight={700}
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {d.sharePct.toFixed(1)}%
                          </text>
                          <text
                            x={labelPos.x}
                            y={labelPos.y + 14.5}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill="#e8ebf3"
                            fontSize={9.8}
                            fontWeight={500}
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {d.kwh.toFixed(1)} kWh
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>

              {/* 内側の円: PV1〜PV4 (外側の円と同じ時計回り順・境界一致) */}
              <g className="pv-donut-inner-ring">
                {innerSlices.map((s) => {
                  const pathD = describeAnnularSector(
                    R1_IN,
                    R1_OUT,
                    s.startRad,
                    s.endRad,
                    innerSlices.length,
                  );
                  const active = isInnerActive(s);
                  const dimmed = Boolean(hover) && !active;
                  const rMid = (R1_IN + R1_OUT) / 2;
                  const arcLen = rMid * (s.endRad - s.startRad);
                  const isCompact = arcLen < 78;
                  const isTiny = arcLen < 36;
                  const labelPos = polarToCart(isCompact ? rMid + 6 : rMid, s.midRad);
                  const callout = isTiny
                    ? computeCalloutAnchor(s.midRad, R2_OUT + 12)
                    : null;

                  return (
                    <g
                      key={s.key}
                      className={`pv-donut-slice${active ? " is-active" : ""}${dimmed ? " is-dimmed" : ""}`}
                      onMouseEnter={() =>
                        setHover({
                          kind: "pv",
                          key: s.key,
                          x: labelPos.x,
                          y: labelPos.y,
                        })
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        setHover((prev) =>
                          prev?.kind === "pv" && prev.key === s.key
                            ? null
                            : { kind: "pv", key: s.key, x: labelPos.x, y: labelPos.y },
                        );
                      }}
                    >
                      <path
                        d={pathD}
                        fill={s.fill}
                        fillRule="evenodd"
                        stroke={s.color}
                        strokeWidth={active ? 2 : 1.35}
                      />
                      {isTiny && callout ? (
                        <g className="pv-donut-callout">
                          <text
                            x={callout.tx}
                            y={callout.ty - 5}
                            textAnchor={callout.textAnchor}
                            dominantBaseline="central"
                            fill={s.color}
                            fontSize={10}
                            fontWeight={700}
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {s.label}
                          </text>
                          <text
                            x={callout.tx}
                            y={callout.ty + 6}
                            textAnchor={callout.textAnchor}
                            dominantBaseline="central"
                            fill="#eef0f6"
                            fontSize={9.5}
                            fontWeight={600}
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {s.sharePct.toFixed(1)}%
                          </text>
                        </g>
                      ) : isCompact ? (
                        <g className="pv-donut-slice-label">
                          <text
                            x={labelPos.x}
                            y={labelPos.y - 6}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill="#ffffff"
                            fontSize={11.5}
                            fontWeight={700}
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {s.label}
                          </text>
                          <text
                            x={labelPos.x}
                            y={labelPos.y + 8}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill={s.color}
                            fontSize={10.5}
                            fontWeight={700}
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {s.sharePct.toFixed(1)}%
                          </text>
                        </g>
                      ) : (
                        <g className="pv-donut-slice-label">
                          <text
                            x={labelPos.x}
                            y={labelPos.y - 13.5}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill="#ffffff"
                            fontSize={13}
                            fontWeight={700}
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {s.label}
                          </text>
                          <text
                            x={labelPos.x}
                            y={labelPos.y + 1}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill={s.color}
                            fontSize={12}
                            fontWeight={700}
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {s.sharePct.toFixed(1)}%
                          </text>
                          <text
                            x={labelPos.x}
                            y={labelPos.y + 15}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill="#e2e5ef"
                            fontSize={9.8}
                            fontWeight={500}
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {s.kwh.toFixed(1)} kWh
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>

              {/* 中央の円: 選択年と年間総発電量 */}
              <circle
                cx={CX}
                cy={CY}
                r={R_HOLE - 2}
                fill="#24262d"
                stroke="#454852"
                strokeWidth={1.2}
              />
              <text
                x={CX}
                y={CY - 20}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#fbdd84"
                fontSize={10}
                fontWeight={600}
                letterSpacing="0.08em"
                fontFamily="JetBrains Mono, monospace"
              >
                {selectedYear} ANNUAL
              </text>
              <text
                x={CX}
                y={CY + 1}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#f2f4f8"
                fontSize={totalFontSize}
                fontWeight={600}
                fontFamily="'Space Grotesk', sans-serif"
              >
                {annual.total.toFixed(1)}
                <tspan fill="#b8bbc6" fontSize={10} fontWeight={500}>
                  {" "}kWh
                </tspan>
              </text>
              <text
                x={CX}
                y={CY + 21}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#9aa0ae"
                fontSize={8.5}
                letterSpacing="0.04em"
                fontFamily="JetBrains Mono, monospace"
              >
                (PV &amp; DIRECTION)
              </text>
            </>
          )}
        </svg>

        {hover && (hoveredInner || hoveredOuter) ? (
          <div
            className="pv-donut-tooltip"
            style={{
              left: `${Math.min(76, Math.max(24, (hover.x / SVG_W) * 100))}%`,
              top: hover.y < CY * 0.85
                ? `${Math.min(70, ((hover.y + 24) / SVG_H) * 100)}%`
                : undefined,
              bottom: hover.y >= CY * 0.85
                ? `${Math.min(74, ((SVG_H - hover.y + 18) / SVG_H) * 100)}%`
                : undefined,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sim-tooltip">
              {hoveredInner ? (
                <>
                  <div className="sim-tooltip-title">
                    <span style={{ color: hoveredInner.color }}>{hoveredInner.label}</span>
                    <span className="pv-quad-dir">{hoveredInner.directionLabel}</span>
                  </div>
                  <div className="sim-tooltip-row">
                    <span className="sim-tooltip-label">ANNUAL:</span>
                    <span>{hoveredInner.kwh.toFixed(1)} kWh</span>
                  </div>
                  <div className="sim-tooltip-row">
                    <span className="sim-tooltip-label">TOTAL SHARE:</span>
                    <span className="sim-tooltip-pct">{hoveredInner.sharePct.toFixed(1)}%</span>
                  </div>
                  <div className="sim-tooltip-row">
                    <span className="sim-tooltip-label">{hoveredInner.directionLabel} SHARE:</span>
                    <span>{hoveredInner.dirSharePct.toFixed(1)}%</span>
                  </div>
                  <div className="sim-tooltip-row">
                    <span className="sim-tooltip-label">ARRAY:</span>
                    <span>{hoveredInner.panelCount} panels</span>
                  </div>
                </>
              ) : hoveredOuter ? (
                <>
                  <div className="sim-tooltip-title" style={{ color: hoveredOuter.textColor }}>
                    {hoveredOuter.label}
                  </div>
                  <div className="sim-tooltip-row">
                    <span className="sim-tooltip-label">ANNUAL:</span>
                    <span>{hoveredOuter.kwh.toFixed(1)} kWh</span>
                  </div>
                  <div className="sim-tooltip-row">
                    <span className="sim-tooltip-label">TOTAL SHARE:</span>
                    <span className="sim-tooltip-pct">{hoveredOuter.sharePct.toFixed(1)}%</span>
                  </div>
                  <div className="sim-tooltip-pv-list">
                    {hoveredOuter.pvs.map((pv) => (
                      <div key={pv.key} className="sim-tooltip-row sim-tooltip-pv-row">
                        <span className="sim-tooltip-label" style={{ color: pv.color }}>
                          {pv.label}:
                        </span>
                        <span className="sim-tooltip-pv-val">
                          {pv.kwh.toFixed(1)} kWh ({pv.sharePct.toFixed(1)}%)
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PvChartsView({
  records,
  selectedYear,
  monthlyActualKwh,
}: {
  records: PvMonthlyRecord[];
  selectedYear: number;
  monthlyActualKwh: Record<number, number>;
}) {
  const annual = React.useMemo(
    () => aggregateAnnualPvTotals(records, monthlyActualKwh),
    [records, monthlyActualKwh],
  );

  return (
    <div className="summary-subpage pv-charts-subpage">
      <section className="summary-graph-block" aria-label="Annual Generation by PV and Direction">
        <div className="summary-subpage-head">
          <span className="summary-subpage-title">ANNUAL BY PV &amp; DIRECTION</span>
        </div>

        <div className="sim-chart-box summary-chart-box pv-donut-card">
          <PvDonutChart annual={annual} selectedYear={selectedYear} />
        </div>
      </section>
    </div>
  );
}

let pvChartsRoot: Root | null = null;

export function mountOrUpdatePvCharts(
  records: PvMonthlyRecord[],
  selectedYear: number,
  monthlyActualKwh: Record<number, number> = {},
): void {
  const container = document.getElementById("pv-charts-root");
  if (!container) return;
  if (!pvChartsRoot) {
    pvChartsRoot = createRoot(container);
  }
  pvChartsRoot.render(
    <PvChartsView
      records={records}
      selectedYear={selectedYear}
      monthlyActualKwh={monthlyActualKwh}
    />,
  );
}
