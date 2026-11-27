export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];
type Vec3 = [number, number, number];

export interface SolarSnapshot {
  declinationRad: number;
  hourAngleRad: number;
  altitudeDeg: number;
  azimuthDeg: number;
  isDaylight: boolean;
  sunVec: Vec3;
}

export const SOLAR_PULSE_DURATION = 3.2;
export const SOLAR_WAVE_COUNT = 2;

export const PV_BASE_COLORS: Record<1 | 2 | 3 | 4, RGB> = {
  1: [255 / 255, 122 / 255, 24 / 255],  // Neon Orange (#ff7a18)
  2: [255 / 255, 60 / 255, 166 / 255],  // Neon Pink (#ff3ca6)
  3: [158 / 255, 255 / 255, 20 / 255],  // Neon Yellow-Green (#9eff14)
  4: [0 / 255, 229 / 255, 255 / 255],   // Neon Cyan (#00e5ff)
};

function srgbChanToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** sRGB色 (CSS hex相当) を glTF Linear 色空間へ変換 */
export function srgbToLinear(rgb: RGB, scale = 1): RGB {
  return [
    srgbChanToLinear(rgb[0]) * scale,
    srgbChanToLinear(rgb[1]) * scale,
    srgbChanToLinear(rgb[2]) * scale,
  ];
}

// 2D SVG (190..450 x 106..334, center 320,220) を 実際の 5.9寸 (30.54°) 寄棟屋根として3D空間へマッピング
const SVG_CX = 320;
const SVG_CY = 220;
const SVG_HALF_W = 130;
const SVG_HALF_H = 114;

const DOME_RADIUS = 1.0;
const ROOF_HX = 0.415;
const ROOF_HZ = ROOF_HX * (SVG_HALF_H / SVG_HALF_W); // ~0.3639
const ROOF_SLOPE = 0.59; // 正確な 5.9/10 勾配 (atan(0.59) = 30.54°)
const ROOF_EAVE_Y = 0.022;
const ROOF_APEX_H = ROOF_HZ * ROOF_SLOPE; // 全4面同一の 5.9寸 勾配
const ROOF_APEX_Y = ROOF_EAVE_Y + ROOF_APEX_H;
const ROOF_RIDGE_HX = ROOF_HX - ROOF_HZ; // ~0.0511 (東西方向の大棟半長)

interface PanelRect {
  pv: 1 | 2 | 3 | 4;
  x: number;
  y: number;
  w: number;
  h: number;
}

const PV_PANELS: PanelRect[] = [
  // NORTH: PV4 (CS6.2-48TM-445 × 3)
  { pv: 4, x: 289, y: 124, w: 29, h: 18.5 },
  { pv: 4, x: 322, y: 124, w: 29, h: 18.5 },
  { pv: 4, x: 305.5, y: 146.5, w: 29, h: 18.5 },
  // WEST: PV3 (CS6.2-48TM-465 × 3)
  { pv: 3, x: 206, y: 157.5, w: 18.5, h: 29 },
  { pv: 3, x: 206, y: 189.5, w: 18.5, h: 29 },
  { pv: 3, x: 206, y: 221.5, w: 18.5, h: 29 },
  // WEST: PV1 (CS6.2-48TM-465 × 1 + CS6.2-32TM-310 × 4)
  { pv: 1, x: 206, y: 253.5, w: 18.5, h: 29 },
  { pv: 1, x: 228.5, y: 173.5, w: 12.5, h: 29 },
  { pv: 1, x: 228.5, y: 205.5, w: 12.5, h: 29 },
  { pv: 1, x: 228.5, y: 237.5, w: 12.5, h: 29 },
  { pv: 1, x: 245, y: 189.5, w: 12.5, h: 29 },
  // EAST: PV2 (CS6.2-36TM-350 × 2 + CS6.2-48TM-465 × 2)
  { pv: 2, x: 382, y: 192, w: 18.5, h: 22 },
  { pv: 2, x: 404.5, y: 192, w: 18.5, h: 22 },
  { pv: 2, x: 382, y: 218, w: 18.5, h: 29 },
  { pv: 2, x: 404.5, y: 218, w: 18.5, h: 29 },
];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scaleVec(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function dotVec(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normVec(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-8) return [0, 1, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * 座標変換 (glTF Right-Handed Y-Up):
 * +X = East, -X = West, -Z = North, +Z = South, +Y = Zenith
 */
export function solarVec(
  latRad: number,
  declRad: number,
  hourAngleRad: number,
  radius = DOME_RADIUS,
): Vec3 {
  const sinPhi = Math.sin(latRad);
  const cosPhi = Math.cos(latRad);
  const sinDecl = Math.sin(declRad);
  const cosDecl = Math.cos(declRad);
  const cosH = Math.cos(hourAngleRad);
  const sinH = Math.sin(hourAngleRad);

  const x = -cosDecl * sinH;
  const y = sinPhi * sinDecl + cosPhi * cosDecl * cosH;
  const z = sinPhi * cosDecl * cosH - cosPhi * sinDecl;
  return [x * radius, y * radius, z * radius];
}

/** NOAA太陽位置計算 (任意時刻・緯度経度に対する太陽赤緯・時角・高度・方位角) */
export function computeSolarSnapshot(
  now: Date,
  lat: number,
  lon: number,
): SolarSnapshot {
  const rad = Math.PI / 180;
  const startOfUtcYear = Date.UTC(now.getUTCFullYear(), 0, 1);
  const dayOfYear =
    Math.floor((now.getTime() - startOfUtcYear) / 86400000) + 1;
  const utcMinOfDay =
    now.getUTCHours() * 60 + now.getUTCMinutes() + now.getUTCSeconds() / 60;

  const gamma =
    ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utcMinOfDay / 60 - 12) / 24);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const declRad =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const trueSolarMin = (((utcMinOfDay + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngleRad = (trueSolarMin / 4 - 180) * rad;
  const latRad = lat * rad;
  const sunVec = solarVec(latRad, declRad, hourAngleRad, 1.0);

  const altitudeDeg = Math.asin(clamp(sunVec[1], -1, 1)) / rad;
  const azRad = Math.atan2(sunVec[0], -sunVec[2]);
  const azimuthDeg = ((azRad / rad) % 360 + 360) % 360;

  return {
    declinationRad: declRad,
    hourAngleRad,
    altitudeDeg,
    azimuthDeg,
    isDaylight: sunVec[1] >= -0.01,
    sunVec,
  };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

function buildSunBeamWavePng(): Uint8Array {
  const height = 128;
  const raw = new Uint8Array(height * 5);
  let s1 = 1;
  let s2 = 0;
  for (let y = 0; y < height; y++) {
    const off = y * 5;
    const wave = 0.5 + 0.5 * Math.cos((2 * Math.PI * y) / height);
    const pulse = Math.pow(wave, 1.5);
    const r = 255;
    const g = Math.round(196 + 56 * pulse);
    const b = Math.round(74 + 150 * pulse);
    const alpha = Math.round((0.4 + 0.6 * pulse) * 255);
    raw[off] = 0;
    raw[off + 1] = r;
    raw[off + 2] = g;
    raw[off + 3] = b;
    raw[off + 4] = alpha;
  }
  for (let i = 0; i < raw.length; i++) {
    s1 = (s1 + raw[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  const adler = ((s2 << 16) | s1) >>> 0;

  const zlib = new Uint8Array(2 + 5 + raw.length + 4);
  zlib[0] = 0x78;
  zlib[1] = 0x01;
  zlib[2] = 0x01;
  zlib[3] = raw.length & 0xff;
  zlib[4] = (raw.length >>> 8) & 0xff;
  zlib[5] = (~raw.length) & 0xff;
  zlib[6] = ((~raw.length) >>> 8) & 0xff;
  zlib.set(raw, 7);
  new DataView(zlib.buffer).setUint32(7 + raw.length, adler, false);

  const ihdr = new Uint8Array(13);
  const idv = new DataView(ihdr.buffer);
  idv.setUint32(0, 1, false);
  idv.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const c1 = pngChunk("IHDR", ihdr);
  const c2 = pngChunk("IDAT", zlib);
  const c3 = pngChunk("IEND", new Uint8Array(0));
  const total = new Uint8Array(sig.length + c1.length + c2.length + c3.length);
  let pos = 0;
  for (const part of [sig, c1, c2, c3]) {
    total.set(part, pos);
    pos += part.length;
  }
  return total;
}

interface MaterialDef {
  name: string;
  baseColorFactor: RGBA;
  baseColorTextureIndex?: number;
  emissiveFactor?: RGB;
  emissiveStrength?: number;
  metallicFactor?: number;
  roughnessFactor?: number;
  unlit?: boolean;
  alphaMode?: "OPAQUE" | "BLEND";
  doubleSided?: boolean;
  useVertexColors?: boolean;
}

interface PrimitiveBucket {
  meshKey: string;
  materialIndex: number;
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
}

interface NodeAnimTrack {
  nodeIndex: number;
  path: "translation" | "scale";
  values: number[];
}

interface SceneNodeDef {
  name: string;
  meshKey: string;
  translation?: Vec3;
  rotation?: [number, number, number, number];
  scale?: Vec3;
}

class GlbBuilder {
  private materials: MaterialDef[] = [];
  private materialMap = new Map<string, number>();
  private textures: Uint8Array[] = [];
  private buckets: PrimitiveBucket[] = [];
  private bucketMap = new Map<string, PrimitiveBucket>();
  private extraNodes: SceneNodeDef[] = [];
  private animName: string | null = null;
  private animTimes: number[] = [];
  private animTracks: NodeAnimTrack[] = [];

  defineTexture(pngBytes: Uint8Array): number {
    const idx = this.textures.length;
    this.textures.push(pngBytes);
    return idx;
  }

  defineMaterial(def: MaterialDef): number {
    const idx = this.materials.length;
    this.materials.push(def);
    this.materialMap.set(def.name, idx);
    return idx;
  }

  private bucket(name: string, meshKey = "static"): PrimitiveBucket {
    const idx = this.materialMap.get(name);
    if (idx === undefined) {
      throw new Error(`Unknown material: ${name}`);
    }
    const key = `${meshKey}::${idx}`;
    let bk = this.bucketMap.get(key);
    if (!bk) {
      bk = {
        meshKey,
        materialIndex: idx,
        positions: [],
        normals: [],
        uvs: [],
        colors: [],
        indices: [],
      };
      this.bucketMap.set(key, bk);
      this.buckets.push(bk);
    }
    return bk;
  }

  addNode(node: SceneNodeDef): number {
    const nodeIdx = 1 + this.extraNodes.length;
    this.extraNodes.push(node);
    return nodeIdx;
  }

  setAnimation(name: string, times: number[], tracks: NodeAnimTrack[]): void {
    this.animName = name;
    this.animTimes = times;
    this.animTracks = tracks;
  }

  addTriangle(mat: string, p0: Vec3, p1: Vec3, p2: Vec3, explicitNormal?: Vec3): void {
    const b = this.bucket(mat);
    const base = b.positions.length / 3;
    const n = explicitNormal ?? normVec(crossVec(subVec(p1, p0), subVec(p2, p0)));
    b.positions.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
    b.normals.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
    b.indices.push(base, base + 1, base + 2);
  }

  addQuad(mat: string, p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, explicitNormal?: Vec3): void {
    const n = explicitNormal ?? normVec(crossVec(subVec(p1, p0), subVec(p2, p0)));
    this.addTriangle(mat, p0, p1, p2, n);
    this.addTriangle(mat, p0, p2, p3, n);
  }

  addDisc(mat: string, radius: number, y: number, segs = 64): void {
    const b = this.bucket(mat);
    const centerIdx = b.positions.length / 3;
    b.positions.push(0, y, 0);
    b.normals.push(0, 1, 0);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      b.positions.push(Math.cos(a) * radius, y, -Math.sin(a) * radius);
      b.normals.push(0, 1, 0);
    }
    for (let i = 0; i < segs; i++) {
      b.indices.push(centerIdx, centerIdx + 1 + i, centerIdx + 2 + i);
    }
  }

  addTubeCurve(
    mat: string,
    points: Vec3[],
    radius: number,
    closed = false,
    radialSegs = 6,
  ): void {
    if (points.length < 2) return;
    const b = this.bucket(mat);
    const count = points.length;
    const tangents: Vec3[] = [];
    for (let i = 0; i < count; i++) {
      const prev = closed
        ? points[(i - 1 + count) % count]
        : points[Math.max(0, i - 1)];
      const next = closed
        ? points[(i + 1) % count]
        : points[Math.min(count - 1, i + 1)];
      tangents.push(normVec(subVec(next, prev)));
    }

    const upGuess: Vec3 = Math.abs(tangents[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let normal = normVec(crossVec(upGuess, tangents[0]));
    let binormal = normVec(crossVec(tangents[0], normal));

    const ringStart = b.positions.length / 3;
    for (let i = 0; i < count; i++) {
      const t = tangents[i];
      if (i > 0) {
        const proj = subVec(normal, scaleVec(t, dotVec(normal, t)));
        normal = Math.hypot(proj[0], proj[1], proj[2]) > 1e-6 ? normVec(proj) : normal;
        binormal = normVec(crossVec(t, normal));
      }
      const p = points[i];
      for (let j = 0; j < radialSegs; j++) {
        const ang = (j / radialSegs) * Math.PI * 2;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const radial = addVec(scaleVec(normal, c), scaleVec(binormal, s));
        const pos = addVec(p, scaleVec(radial, radius));
        b.positions.push(pos[0], pos[1], pos[2]);
        b.normals.push(radial[0], radial[1], radial[2]);
      }
    }

    const segCount = closed ? count : count - 1;
    for (let i = 0; i < segCount; i++) {
      const r0 = ringStart + i * radialSegs;
      const r1 = ringStart + ((i + 1) % count) * radialSegs;
      for (let j = 0; j < radialSegs; j++) {
        const jNext = (j + 1) % radialSegs;
        const i00 = r0 + j;
        const i01 = r0 + jNext;
        const i10 = r1 + j;
        const i11 = r1 + jNext;
        b.indices.push(i00, i01, i11, i00, i11, i10);
      }
    }
  }

  /**
   * 単一外殻による自然な太陽光円錐メッシュ (屋根から遠い側を手前で透明化 + UV流れ用TEXCOORD_0)
   */
  addSunBeamCone(
    mat: string,
    from: Vec3,
    to: Vec3,
    tStart = 0.02,
    rStart = 0.048,
    tEnd = 1.04,
    rEnd = 0.29,
    axialRings = 32,
    radialSegs = 36,
  ): void {
    const b = this.bucket(mat, "static");
    const axis = subVec(to, from);
    const axisNorm = normVec(axis);
    const upGuess: Vec3 = Math.abs(axisNorm[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const uVec = normVec(crossVec(upGuess, axisNorm));
    const vVec = normVec(crossVec(axisNorm, uVec));

    // 各放射角度(j)について、屋根から遠いレイほど手前のtで透明になる到達終端 rayEndT[j] を算出
    const rayEndT: number[] = [];
    const radialDirs: Vec3[] = [];
    for (let j = 0; j < radialSegs; j++) {
      const ang = (j / radialSegs) * Math.PI * 2;
      const radial = addVec(
        scaleVec(uVec, Math.cos(ang)),
        scaleVec(vVec, Math.sin(ang)),
      );
      radialDirs.push(radial);

      const pEnd = addVec(addVec(from, scaleVec(axis, tEnd)), scaleVec(radial, rEnd));
      const cx = clamp(pEnd[0], -ROOF_HX, ROOF_HX);
      const cz = clamp(pEnd[2], -ROOF_HZ, ROOF_HZ);
      const outDist = Math.hypot(pEnd[0] - cx, pEnd[2] - cz);
      const roofYAtEnd =
        ROOF_EAVE_Y +
        Math.max(0, Math.min(ROOF_HX - Math.abs(cx), ROOF_HZ - Math.abs(cz))) * ROOF_SLOPE;
      const aboveDist = Math.max(0, pEnd[1] - roofYAtEnd);

      const farness = clamp((aboveDist * 1.15 + outDist * 1.25) / 0.42, 0, 1);
      rayEndT.push(tEnd - 0.46 * farness);
    }

    const ringStart = b.positions.length / 3;
    const peakAlpha = 0.34;
    for (let i = 0; i <= axialRings; i++) {
      const frac = i / axialRings;
      const t = tStart + (tEnd - tStart) * frac;
      const r = rStart + (rEnd - rStart) * frac;
      const center = addVec(from, scaleVec(axis, t));

      for (let j = 0; j < radialSegs; j++) {
        const radial = radialDirs[j];
        const pos = addVec(center, scaleVec(radial, r));
        b.positions.push(pos[0], pos[1], pos[2]);
        b.normals.push(radial[0], radial[1], radial[2]);
        b.uvs.push(j / radialSegs, t * 2.5);

        const u = clamp((t - tStart) / Math.max(0.05, rayEndT[j] - tStart), 0, 1);
        const axialFade = Math.pow(1 - u, 1.15);
        const groundFade = clamp((pos[1] + 0.005) / 0.03, 0, 1);
        b.colors.push(1, 1, 1, peakAlpha * axialFade * groundFade);
      }
    }

    for (let i = 0; i < axialRings; i++) {
      const r0 = ringStart + i * radialSegs;
      const r1 = ringStart + (i + 1) * radialSegs;
      for (let j = 0; j < radialSegs; j++) {
        const jNext = (j + 1) % radialSegs;
        const i00 = r0 + j;
        const i01 = r0 + jNext;
        const i10 = r1 + j;
        const i11 = r1 + jNext;
        b.indices.push(i00, i01, i11, i00, i11, i10);
      }
    }
  }

  addSphere(
    mat: string,
    center: Vec3,
    radius: number,
    latSegs = 12,
    lonSegs = 20,
    meshKey = "static",
  ): void {
    const b = this.bucket(mat, meshKey);
    const startIdx = b.positions.length / 3;
    for (let lat = 0; lat <= latSegs; lat++) {
      const theta = (lat / latSegs) * Math.PI;
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      for (let lon = 0; lon <= lonSegs; lon++) {
        const phi = (lon / lonSegs) * Math.PI * 2;
        const nx = sinT * Math.cos(phi);
        const ny = cosT;
        const nz = sinT * Math.sin(phi);
        b.positions.push(
          center[0] + nx * radius,
          center[1] + ny * radius,
          center[2] + nz * radius,
        );
        b.normals.push(nx, ny, nz);
      }
    }
    const stride = lonSegs + 1;
    for (let lat = 0; lat < latSegs; lat++) {
      for (let lon = 0; lon < lonSegs; lon++) {
        const a = startIdx + lat * stride + lon;
        const bIdx = a + stride;
        b.indices.push(a, a + 1, bIdx, bIdx, a + 1, bIdx + 1);
      }
    }
  }

  buildGlb(): Uint8Array {
    const activeBuckets = this.buckets.filter((bk) => bk.indices.length > 0);
    const bufferViews: Array<{
      buffer: number;
      byteOffset: number;
      byteLength: number;
      target?: number;
    }> = [];
    const accessors: Array<{
      bufferView: number;
      byteOffset: number;
      componentType: number;
      count: number;
      type: string;
      min?: number[];
      max?: number[];
    }> = [];

    type GlbPrimitive = {
      attributes: {
        POSITION: number;
        NORMAL: number;
        TEXCOORD_0?: number;
        COLOR_0?: number;
      };
      indices: number;
      material: number;
    };

    const primitivesByMesh = new Map<string, GlbPrimitive[]>();
    primitivesByMesh.set("static", []);

    const chunks: Uint8Array[] = [];
    let byteCursor = 0;

    const appendAligned = (bytes: Uint8Array, target?: number): number => {
      const viewIndex = bufferViews.length;
      const view: {
        buffer: number;
        byteOffset: number;
        byteLength: number;
        target?: number;
      } = {
        buffer: 0,
        byteOffset: byteCursor,
        byteLength: bytes.byteLength,
      };
      if (target !== undefined) view.target = target;
      bufferViews.push(view);
      chunks.push(bytes);
      byteCursor += bytes.byteLength;
      const rem = byteCursor % 4;
      if (rem !== 0) {
        const pad = 4 - rem;
        chunks.push(new Uint8Array(pad));
        byteCursor += pad;
      }
      return viewIndex;
    };

    for (const bk of activeBuckets) {
      const posArr = new Float32Array(bk.positions);
      const normArr = new Float32Array(bk.normals);
      const idxArr = new Uint16Array(bk.indices);

      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < posArr.length; i += 3) {
        if (posArr[i] < minX) minX = posArr[i];
        if (posArr[i] > maxX) maxX = posArr[i];
        if (posArr[i + 1] < minY) minY = posArr[i + 1];
        if (posArr[i + 1] > maxY) maxY = posArr[i + 1];
        if (posArr[i + 2] < minZ) minZ = posArr[i + 2];
        if (posArr[i + 2] > maxZ) maxZ = posArr[i + 2];
      }

      const posView = appendAligned(new Uint8Array(posArr.buffer), 34962);
      const normView = appendAligned(new Uint8Array(normArr.buffer), 34962);

      let uvAcc: number | undefined;
      if (bk.uvs.length > 0) {
        const uvArr = new Float32Array(bk.uvs);
        const uvView = appendAligned(new Uint8Array(uvArr.buffer), 34962);
        uvAcc = accessors.length;
        accessors.push({
          bufferView: uvView,
          byteOffset: 0,
          componentType: 5126,
          count: uvArr.length / 2,
          type: "VEC2",
        });
      }

      let colorAcc: number | undefined;
      if (bk.colors.length > 0) {
        const colArr = new Float32Array(bk.colors);
        const colView = appendAligned(new Uint8Array(colArr.buffer), 34962);
        colorAcc = accessors.length;
        accessors.push({
          bufferView: colView,
          byteOffset: 0,
          componentType: 5126,
          count: colArr.length / 4,
          type: "VEC4",
        });
      }

      const idxView = appendAligned(new Uint8Array(idxArr.buffer), 34963);

      const posAcc = accessors.length;
      accessors.push({
        bufferView: posView,
        byteOffset: 0,
        componentType: 5126,
        count: posArr.length / 3,
        type: "VEC3",
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
      });

      const normAcc = accessors.length;
      accessors.push({
        bufferView: normView,
        byteOffset: 0,
        componentType: 5126,
        count: normArr.length / 3,
        type: "VEC3",
      });

      const idxAcc = accessors.length;
      accessors.push({
        bufferView: idxView,
        byteOffset: 0,
        componentType: 5123,
        count: idxArr.length,
        type: "SCALAR",
      });

      const attrs: {
        POSITION: number;
        NORMAL: number;
        TEXCOORD_0?: number;
        COLOR_0?: number;
      } = {
        POSITION: posAcc,
        NORMAL: normAcc,
      };
      if (uvAcc !== undefined) attrs.TEXCOORD_0 = uvAcc;
      if (colorAcc !== undefined) attrs.COLOR_0 = colorAcc;

      let list = primitivesByMesh.get(bk.meshKey);
      if (!list) {
        list = [];
        primitivesByMesh.set(bk.meshKey, list);
      }
      list.push({
        attributes: attrs,
        indices: idxAcc,
        material: bk.materialIndex,
      });
    }

    const gltfImages: Array<{ bufferView: number; mimeType: string }> = [];
    const gltfSamplers: Array<{
      magFilter: number;
      minFilter: number;
      wrapS: number;
      wrapT: number;
    }> = [];
    const gltfTextures: Array<{ sampler: number; source: number }> = [];
    if (this.textures.length > 0) {
      gltfSamplers.push({
        magFilter: 9729,
        minFilter: 9729,
        wrapS: 33071,
        wrapT: 10497,
      });
      for (const png of this.textures) {
        const imgView = appendAligned(png);
        const imgIdx = gltfImages.length;
        gltfImages.push({ bufferView: imgView, mimeType: "image/png" });
        gltfTextures.push({ sampler: 0, source: imgIdx });
      }
    }

    const meshes: Array<{ name: string; primitives: GlbPrimitive[] }> = [];
    const meshIndexByKey = new Map<string, number>();
    for (const [key, list] of primitivesByMesh.entries()) {
      if (list.length === 0) continue;
      meshIndexByKey.set(key, meshes.length);
      meshes.push({
        name: key === "static" ? "SolarHemisphereMesh" : `${key}_Mesh`,
        primitives: list,
      });
    }

    const gltfNodes: Array<Record<string, unknown>> = [
      { mesh: meshIndexByKey.get("static") ?? 0, name: "SolarHemisphereRoot" },
    ];
    for (const n of this.extraNodes) {
      const mIdx = meshIndexByKey.get(n.meshKey);
      if (mIdx === undefined) continue;
      const obj: Record<string, unknown> = {
        name: n.name,
        mesh: mIdx,
      };
      if (n.translation) obj.translation = n.translation;
      if (n.rotation) obj.rotation = n.rotation;
      if (n.scale) obj.scale = n.scale;
      gltfNodes.push(obj);
    }

    let animations: Array<Record<string, unknown>> | undefined;
    if (this.animName && this.animTimes.length >= 2 && this.animTracks.length > 0) {
      const timeArr = new Float32Array(this.animTimes);
      const timeView = appendAligned(new Uint8Array(timeArr.buffer));
      const timeAcc = accessors.length;
      accessors.push({
        bufferView: timeView,
        byteOffset: 0,
        componentType: 5126,
        count: timeArr.length,
        type: "SCALAR",
        min: [timeArr[0]],
        max: [timeArr[timeArr.length - 1]],
      });

      const samplers: Array<Record<string, unknown>> = [];
      const channels: Array<Record<string, unknown>> = [];
      for (const tr of this.animTracks) {
        const valArr = new Float32Array(tr.values);
        const valView = appendAligned(new Uint8Array(valArr.buffer));
        const valAcc = accessors.length;
        accessors.push({
          bufferView: valView,
          byteOffset: 0,
          componentType: 5126,
          count: valArr.length / 3,
          type: "VEC3",
        });
        const samplerIdx = samplers.length;
        samplers.push({
          input: timeAcc,
          interpolation: "LINEAR",
          output: valAcc,
        });
        channels.push({
          sampler: samplerIdx,
          target: { node: tr.nodeIndex, path: tr.path },
        });
      }
      animations = [{ name: this.animName, samplers, channels }];
    }

    let usesEmissiveStrength = false;
    const gltfMaterials = this.materials.map((m) => {
      const pbr: Record<string, unknown> = {
        baseColorFactor: m.baseColorFactor,
        metallicFactor: m.metallicFactor ?? (m.unlit ? 0 : 0.08),
        roughnessFactor: m.roughnessFactor ?? (m.unlit ? 1 : 0.72),
      };
      if (m.baseColorTextureIndex !== undefined) {
        pbr.baseColorTexture = { index: m.baseColorTextureIndex };
      }
      const matObj: Record<string, unknown> = {
        name: m.name,
        pbrMetallicRoughness: pbr,
      };
      if (m.emissiveFactor) matObj.emissiveFactor = m.emissiveFactor;
      if (m.alphaMode && m.alphaMode !== "OPAQUE") matObj.alphaMode = m.alphaMode;
      if (m.doubleSided) matObj.doubleSided = true;
      const exts: Record<string, unknown> = {};
      if (m.unlit) exts.KHR_materials_unlit = {};
      if (m.emissiveStrength !== undefined && m.emissiveStrength !== 1) {
        exts.KHR_materials_emissive_strength = {
          emissiveStrength: m.emissiveStrength,
        };
        usesEmissiveStrength = true;
      }
      if (Object.keys(exts).length > 0) {
        matObj.extensions = exts;
      }
      return matObj;
    });

    const extensionsUsed = ["KHR_materials_unlit"];
    if (usesEmissiveStrength) {
      extensionsUsed.push("KHR_materials_emissive_strength");
    }

    const gltf: Record<string, unknown> = {
      asset: { version: "2.0", generator: "EP-VIEW-3D" },
      extensionsUsed,
      scene: 0,
      scenes: [{ nodes: gltfNodes.map((_, i) => i) }],
      nodes: gltfNodes,
      meshes,
      materials: gltfMaterials,
      buffers: [{ byteLength: byteCursor }],
      bufferViews,
      accessors,
    };
    if (gltfTextures.length > 0) {
      gltf.images = gltfImages;
      gltf.samplers = gltfSamplers;
      gltf.textures = gltfTextures;
    }
    if (animations) {
      gltf.animations = animations;
    }

    const jsonRaw = new TextEncoder().encode(JSON.stringify(gltf));
    const jsonPadLen = Math.ceil(jsonRaw.length / 4) * 4;
    const binLen = byteCursor;
    const totalLen = 12 + 8 + jsonPadLen + 8 + binLen;

    const out = new Uint8Array(totalLen);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, totalLen, true);

    dv.setUint32(12, jsonPadLen, true);
    dv.setUint32(16, 0x4e4f534a, true);
    out.set(jsonRaw, 20);
    for (let i = jsonRaw.length; i < jsonPadLen; i++) {
      out[20 + i] = 0x20;
    }

    const binHeaderOff = 20 + jsonPadLen;
    dv.setUint32(binHeaderOff, binLen, true);
    dv.setUint32(binHeaderOff + 4, 0x004e4942, true);
    let binWriteOff = binHeaderOff + 8;
    for (const c of chunks) {
      out.set(c, binWriteOff);
      binWriteOff += c.byteLength;
    }
    return out;
  }
}

function roofPointFromSvg(sx: number, sy: number): Vec3 {
  const u = (sx - SVG_CX) / SVG_HALF_W;
  const v = (sy - SVG_CY) / SVG_HALF_H;
  const x = u * ROOF_HX;
  const z = v * ROOF_HZ;
  const distFromEave = Math.min(ROOF_HX - Math.abs(x), ROOF_HZ - Math.abs(z));
  const y = ROOF_EAVE_Y + Math.max(0, distFromEave) * ROOF_SLOPE;
  return [x, y, z];
}

function sampleDaylightArc(
  latRad: number,
  declRad: number,
  radius: number,
  steps = 56,
): Vec3[] {
  const cosH0 = clamp(-Math.tan(latRad) * Math.tan(declRad), -1, 1);
  const h0 = Math.acos(cosH0);
  const pts: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    const h = -h0 + (2 * h0 * i) / steps;
    const p = solarVec(latRad, declRad, h, radius);
    if (p[1] < 0) p[1] = 0;
    pts.push(p);
  }
  return pts;
}

function addSolarPanelMesh(g: GlbBuilder, panel: PanelRect): void {
  const fillMat = `pv${panel.pv}_fill`;
  const edgeMat = `pv${panel.pv}_edge`;

  const p00 = roofPointFromSvg(panel.x, panel.y);
  const p10 = roofPointFromSvg(panel.x + panel.w, panel.y);
  const p11 = roofPointFromSvg(panel.x + panel.w, panel.y + panel.h);
  const p01 = roofPointFromSvg(panel.x, panel.y + panel.h);

  const n = normVec(crossVec(subVec(p01, p00), subVec(p11, p00)));
  const negN: Vec3 = [-n[0], -n[1], -n[2]];
  const baseLift = scaleVec(n, 0.002);
  const rimLift = scaleVec(n, 0.0076);
  const topLift = scaleVec(n, 0.0092);

  const cx = (p00[0] + p10[0] + p11[0] + p01[0]) / 4;
  const cy = (p00[1] + p10[1] + p11[1] + p01[1]) / 4;
  const cz = (p00[2] + p10[2] + p11[2] + p01[2]) / 4;
  const center: Vec3 = [cx, cy, cz];

  const insetCorner = (p: Vec3, amount: number): Vec3 => {
    const toC = subVec(center, p);
    const len = Math.hypot(toC[0], toC[1], toC[2]);
    if (len < 1e-6) return p;
    return addVec(p, scaleVec(toC, Math.min(0.42, amount / len)));
  };

  // 外周を下向きベベル(rimLift -> topLift)にし、中央上面を最上段の完全フラット一枚板にして凹み見えを解消
  const bevelWidth = 0.0028;
  const i00 = insetCorner(p00, bevelWidth);
  const i01 = insetCorner(p01, bevelWidth);
  const i11 = insetCorner(p11, bevelWidth);
  const i10 = insetCorner(p10, bevelWidth);

  const f00 = addVec(i00, topLift);
  const f01 = addVec(i01, topLift);
  const f11 = addVec(i11, topLift);
  const f10 = addVec(i10, topLift);

  const r00 = addVec(p00, rimLift);
  const r01 = addVec(p01, rimLift);
  const r11 = addVec(p11, rimLift);
  const r10 = addVec(p10, rimLift);

  const b00 = addVec(p00, baseLift);
  const b01 = addVec(p01, baseLift);
  const b11 = addVec(p11, baseLift);
  const b10 = addVec(p10, baseLift);

  g.addQuad(fillMat, f00, f01, f11, f10, n);

  // 外向きベベル縁 & 外周側面 & 底面 (隙間ゼロの閉じたソリッド板)
  g.addQuad(edgeMat, r00, r01, f01, f00);
  g.addQuad(edgeMat, r01, r11, f11, f01);
  g.addQuad(edgeMat, r11, r10, f10, f11);
  g.addQuad(edgeMat, r10, r00, f00, r10);

  g.addQuad(edgeMat, b00, b01, r01, r00);
  g.addQuad(edgeMat, b01, b11, r11, r01);
  g.addQuad(edgeMat, b11, b10, r10, r11);
  g.addQuad(edgeMat, b10, b00, r00, r10);
  g.addQuad(edgeMat, b00, b10, b11, b01, negN);
}

/**
 * 5.9寸(30.54°)半透明寄棟屋根＋蛍光ネオンパネル15枚＋天球半球＋季節軌道＋発光太陽を含む .glb を生成
 */
export function buildRoofSolarGlb(snapshot: SolarSnapshot, lat: number): Uint8Array {
  const g = new GlbBuilder();

  // 半透明黒(rgb(15, 16, 18))の寄棟屋根 (約14三角形のため負荷増なし)
  g.defineMaterial({
    name: "roof_surface",
    baseColorFactor: [...srgbToLinear([15 / 255, 16 / 255, 18 / 255]), 0.48],
    metallicFactor: 0.0,
    roughnessFactor: 0.94,
    alphaMode: "BLEND",
    doubleSided: true,
  });
  g.defineMaterial({
    name: "roof_trim",
    baseColorFactor: [...srgbToLinear([24 / 255, 26 / 255, 30 / 255]), 0.86],
    metallicFactor: 0.0,
    roughnessFactor: 0.9,
    alphaMode: "BLEND",
  });
  g.defineMaterial({
    name: "roof_ridge",
    baseColorFactor: [...srgbToLinear([38 / 255, 41 / 255, 48 / 255]), 1],
    unlit: true,
  });

  // PV1〜4 マテリアル: 蛍光ネオン発色 + emissiveStrength ブースト
  for (const pv of [1, 2, 3, 4] as const) {
    const linFill = srgbToLinear(PV_BASE_COLORS[pv], 0.72);
    const linEmissive = srgbToLinear(PV_BASE_COLORS[pv], 0.88);
    const linEdge = srgbToLinear(PV_BASE_COLORS[pv], 1.0);
    g.defineMaterial({
      name: `pv${pv}_fill`,
      baseColorFactor: [linFill[0], linFill[1], linFill[2], 1],
      emissiveFactor: linEmissive,
      emissiveStrength: 1.25,
      metallicFactor: 0.05,
      roughnessFactor: 0.55,
    });
    g.defineMaterial({
      name: `pv${pv}_edge`,
      baseColorFactor: [linEdge[0] * 0.18, linEdge[1] * 0.18, linEdge[2] * 0.18, 1],
      emissiveFactor: linEdge,
      emissiveStrength: 1.9,
      metallicFactor: 0.0,
      roughnessFactor: 1.0,
    });
  }

  // 天球・半透明軌道・発光太陽・光線マテリアル (Linear色空間)
  g.defineMaterial({
    name: "horizon_disc",
    baseColorFactor: [0.055, 0.062, 0.082, 0.7],
    unlit: true,
    alphaMode: "BLEND",
    doubleSided: true,
  });
  g.defineMaterial({
    name: "horizon_ring",
    baseColorFactor: [...srgbToLinear([0.46, 0.5, 0.58]), 1],
    unlit: true,
  });
  g.defineMaterial({
    name: "dome_arch",
    baseColorFactor: [...srgbToLinear([0.42, 0.45, 0.54]), 1],
    unlit: true,
  });
  g.defineMaterial({
    name: "horizon_cross",
    baseColorFactor: [...srgbToLinear([0.38, 0.41, 0.49]), 1],
    unlit: true,
  });
  g.defineMaterial({
    name: "orbit_summer",
    baseColorFactor: [...srgbToLinear([229 / 255, 52 / 255, 61 / 255]), 1],
    unlit: true,
  });
  g.defineMaterial({
    name: "orbit_equinox",
    baseColorFactor: [...srgbToLinear([166 / 255, 60 / 255, 200 / 255]), 1],
    unlit: true,
  });
  g.defineMaterial({
    name: "orbit_winter",
    baseColorFactor: [...srgbToLinear([38 / 255, 93 / 255, 224 / 255]), 1],
    unlit: true,
  });
  g.defineMaterial({
    name: "orbit_today",
    baseColorFactor: [...srgbToLinear([251 / 255, 221 / 255, 132 / 255]), 1],
    unlit: true,
  });
  g.defineMaterial({
    name: "sun_sphere",
    baseColorFactor: [...srgbToLinear([1, 0.97, 0.78]), 1],
    emissiveFactor: srgbToLinear([1, 0.92, 0.55]),
    emissiveStrength: 2.2,
    metallicFactor: 0.0,
    roughnessFactor: 1.0,
  });
  const beamWaveTexIdx = snapshot.isDaylight
    ? g.defineTexture(buildSunBeamWavePng())
    : undefined;

  g.defineMaterial({
    name: "sun_halo_base",
    baseColorFactor: [...srgbToLinear([1, 0.9, 0.45]), 0.11],
    unlit: true,
    alphaMode: "BLEND",
  });
  for (let w = 0; w < SOLAR_WAVE_COUNT; w++) {
    g.defineMaterial({
      name: `sun_halo_wave_${w}`,
      baseColorFactor: [...srgbToLinear([1, 0.89, 0.44]), 0],
      unlit: true,
      alphaMode: "BLEND",
    });
  }
  g.defineMaterial({
    name: "sun_beam",
    baseColorFactor: [...srgbToLinear([1.0, 0.95, 0.78]), 1],
    baseColorTextureIndex: beamWaveTexIdx,
    unlit: true,
    alphaMode: "BLEND",
    doubleSided: true,
    useVertexColors: true,
  });

  // 1. 寄棟屋根 (全4面 正確な 5.9/10 = 30.54° 勾配, 半透明のため下面閉塞クワッドは省略)
  const apexW: Vec3 = [-ROOF_RIDGE_HX, ROOF_APEX_Y, 0];
  const apexE: Vec3 = [ROOF_RIDGE_HX, ROOF_APEX_Y, 0];
  const nwTop: Vec3 = [-ROOF_HX, ROOF_EAVE_Y, -ROOF_HZ];
  const neTop: Vec3 = [ROOF_HX, ROOF_EAVE_Y, -ROOF_HZ];
  const seTop: Vec3 = [ROOF_HX, ROOF_EAVE_Y, ROOF_HZ];
  const swTop: Vec3 = [-ROOF_HX, ROOF_EAVE_Y, ROOF_HZ];

  const nwBot: Vec3 = [-ROOF_HX, 0, -ROOF_HZ];
  const neBot: Vec3 = [ROOF_HX, 0, -ROOF_HZ];
  const seBot: Vec3 = [ROOF_HX, 0, ROOF_HZ];
  const swBot: Vec3 = [-ROOF_HX, 0, ROOF_HZ];

  // 北台形・東三角・南台形・西三角
  g.addQuad("roof_surface", apexW, apexE, neTop, nwTop);
  g.addTriangle("roof_surface", apexE, seTop, neTop);
  g.addQuad("roof_surface", apexE, apexW, swTop, seTop);
  g.addTriangle("roof_surface", apexW, nwTop, swTop);

  // 軒先スラブ縁
  g.addQuad("roof_trim", nwTop, neTop, neBot, nwBot);
  g.addQuad("roof_trim", neTop, seTop, seBot, neBot);
  g.addQuad("roof_trim", seTop, swTop, swBot, seBot);
  g.addQuad("roof_trim", swTop, nwTop, nwBot, swBot);

  // 軒外周・大棟・隅棟ライン
  g.addTubeCurve("roof_trim", [nwTop, neTop, seTop, swTop], 0.005, true, 6);
  g.addTubeCurve("roof_ridge", [apexW, apexE], 0.0044, false, 6);
  g.addTubeCurve("roof_ridge", [apexW, nwTop], 0.0042, false, 6);
  g.addTubeCurve("roof_ridge", [apexW, swTop], 0.0042, false, 6);
  g.addTubeCurve("roof_ridge", [apexE, neTop], 0.0042, false, 6);
  g.addTubeCurve("roof_ridge", [apexE, seTop], 0.0042, false, 6);

  // 2. 太陽光パネル 15枚 (PV1〜4)
  for (const panel of PV_PANELS) {
    addSolarPanelMesh(g, panel);
  }

  // 3. 地平円盤 & 外周リング & 方位目盛り & N-S/E-W 点線 & 3D地平方位ラベル
  g.addDisc("horizon_disc", DOME_RADIUS, -0.003, 64);

  const ringPts: Vec3[] = [];
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    ringPts.push([Math.cos(a) * DOME_RADIUS, 0, Math.sin(a) * DOME_RADIUS]);
  }
  g.addTubeCurve("horizon_ring", ringPts, 0.0056, true, 6);

  for (let deg = 0; deg < 360; deg += 30) {
    const rad = (deg * Math.PI) / 180;
    const isCardinal = deg % 90 === 0;
    const rIn = isCardinal ? DOME_RADIUS - 0.055 : DOME_RADIUS - 0.032;
    g.addTubeCurve(
      "horizon_ring",
      [
        [Math.sin(rad) * rIn, 0.001, -Math.cos(rad) * rIn],
        [Math.sin(rad) * DOME_RADIUS, 0.001, -Math.cos(rad) * DOME_RADIUS],
      ],
      isCardinal ? 0.0042 : 0.0026,
      false,
      5,
    );
  }

  g.addTubeCurve("horizon_cross", [[0, 0.0015, -ROOF_HZ - 0.02], [0, 0.0015, -DOME_RADIUS]], 0.0028, false, 5);
  g.addTubeCurve("horizon_cross", [[0, 0.0015, ROOF_HZ + 0.02], [0, 0.0015, DOME_RADIUS]], 0.0028, false, 5);
  g.addTubeCurve("horizon_cross", [[ROOF_HX + 0.02, 0.0015, 0], [DOME_RADIUS, 0.0015, 0]], 0.0028, false, 5);
  g.addTubeCurve("horizon_cross", [[-ROOF_HX - 0.02, 0.0015, 0], [-DOME_RADIUS, 0.0015, 0]], 0.0028, false, 5);

  // 4. 天の子午線アーチ (南 -> 天頂 -> 北)
  const meridianPts: Vec3[] = [];
  for (let i = 0; i <= 56; i++) {
    const a = (i / 56) * Math.PI;
    meridianPts.push([0, Math.sin(a) * DOME_RADIUS, Math.cos(a) * DOME_RADIUS]);
  }
  g.addTubeCurve("dome_arch", meridianPts, 0.0052, false, 6);

  // 5. 季節の太陽軌道 (夏至 +23.44° / 春分・秋分 0° / 冬至 -23.44°)
  const latRad = (lat * Math.PI) / 180;
  const obliqRad = (23.44 * Math.PI) / 180;
  g.addTubeCurve("orbit_summer", sampleDaylightArc(latRad, obliqRad, DOME_RADIUS), 0.005, false, 6);
  g.addTubeCurve("orbit_equinox", sampleDaylightArc(latRad, 0, DOME_RADIUS), 0.005, false, 6);
  g.addTubeCurve("orbit_winter", sampleDaylightArc(latRad, -obliqRad, DOME_RADIUS), 0.005, false, 6);

  // 6. 本日の実太陽軌道 (太め半透明) & 大きな発光太陽球 + コロナ + 屋根へ注ぐ光円錐
  const todayRadius = DOME_RADIUS * 1.006;
  g.addTubeCurve(
    "orbit_today",
    sampleDaylightArc(latRad, snapshot.declinationRad, todayRadius),
    0.0135,
    false,
    8,
  );

  if (snapshot.isDaylight) {
    const sunPos: Vec3 = [
      snapshot.sunVec[0] * todayRadius,
      Math.max(0, snapshot.sunVec[1]) * todayRadius,
      snapshot.sunVec[2] * todayRadius,
    ];
    const beamTarget: Vec3 = [0, ROOF_EAVE_Y + ROOF_APEX_H * 0.52, 0];

    // 太陽本体 + 穏やかな定常コロナ
    g.addSphere("sun_sphere", sunPos, 0.062, 16, 24);
    g.addSphere("sun_halo_base", sunPos, 0.088, 14, 22);

    // 単一外殻の光円錐メッシュ (内部多層なし、屋根から遠い側ほど手前で透明化)
    g.addSunBeamCone("sun_beam", sunPos, beamTarget);

    const animDur = SOLAR_PULSE_DURATION;
    const animSteps = 36;
    const times: number[] = [];
    for (let i = 0; i <= animSteps; i++) {
      times.push((i / animSteps) * animDur);
    }
    const tracks: NodeAnimTrack[] = [];

    for (let w = 0; w < SOLAR_WAVE_COUNT; w++) {
      const phaseOffset = w / SOLAR_WAVE_COUNT;

      // 太陽周囲のコロナ波
      const haloMeshKey = `sun_halo_wave_${w}`;
      g.addSphere(haloMeshKey, [0, 0, 0], 1.0, 14, 22, haloMeshKey);
      const haloNodeIdx = g.addNode({
        name: `SunHaloWave_${w}`,
        meshKey: haloMeshKey,
        translation: sunPos,
        scale: [0.062, 0.062, 0.062],
      });

      const haloScaleVals: number[] = [];
      for (let i = 0; i <= animSteps; i++) {
        const uBase = i === animSteps ? 0 : i / animSteps;
        const phase = ((uBase + phaseOffset) % 1 + 1) % 1;

        if (phase >= 0.9) {
          const rReset = phase < 0.94 ? 0.178 : 0.062;
          haloScaleVals.push(rReset, rReset, rReset);
        } else {
          const progress = phase / 0.9;
          const haloR = 0.062 + 0.116 * (1 - Math.pow(1 - progress, 1.35));
          haloScaleVals.push(haloR, haloR, haloR);
        }
      }

      tracks.push({ nodeIndex: haloNodeIdx, path: "scale", values: haloScaleVals });
    }

    g.setAnimation("SolarPulse", times, tracks);
  }

  return g.buildGlb();
}
