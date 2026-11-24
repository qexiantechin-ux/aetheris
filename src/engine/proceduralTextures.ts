import * as THREE from 'three';
import { PlanetVisualRecipe } from '../types/astronomy';

export interface PlanetTextureSet {
  albedoMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap?: THREE.CanvasTexture;
  cloudMap?: THREE.CanvasTexture;
  nightLightsMap?: THREE.CanvasTexture;
  ringMap?: THREE.CanvasTexture;
  resolutionTier: 'base' | 'high';
}

// Fast deterministic 3D gradient / value noise using pre-allocated permutation table
function buildPermTable(seed: number): Uint8Array {
  const p = new Uint8Array(512);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  let s = seed >>> 0;
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = perm[i];
    perm[i] = perm[j];
    perm[j] = tmp;
  }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  return p;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function grad3(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function noise3(p: Uint8Array, x: number, y: number, z: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fz = Math.floor(z);
  const X = fx & 255;
  const Y = fy & 255;
  const Z = fz & 255;
  const xf = x - fx;
  const yf = y - fy;
  const zf = z - fz;
  const u = fade(xf);
  const v = fade(yf);
  const w = fade(zf);

  const A = p[X] + Y;
  const AA = p[A] + Z;
  const AB = p[A + 1] + Z;
  const B = p[X + 1] + Y;
  const BA = p[B] + Z;
  const BB = p[B + 1] + Z;

  const res = lerp(
    lerp(
      lerp(grad3(p[AA], xf, yf, zf), grad3(p[BA], xf - 1, yf, zf), u),
      lerp(grad3(p[AB], xf, yf - 1, zf), grad3(p[BB], xf - 1, yf - 1, zf), u),
      v,
    ),
    lerp(
      lerp(grad3(p[AA + 1], xf, yf, zf - 1), grad3(p[BA + 1], xf - 1, yf, zf - 1), u),
      lerp(grad3(p[AB + 1], xf, yf - 1, zf - 1), grad3(p[BB + 1], xf - 1, yf - 1, zf - 1), u),
      v,
    ),
    w,
  );
  return res * 0.5 + 0.5;
}

function fbm3(p: Uint8Array, x: number, y: number, z: number, octaves: number): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    val += amp * noise3(p, x * freq, y * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.04;
  }
  return val / norm;
}

function ridgedFbm3(p: Uint8Array, x: number, y: number, z: number, octaves: number): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise3(p, x * freq, y * freq, z * freq) * 2 - 1);
    val += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return val / norm;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
  out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  out[0] = a[0] + (b[0] - a[0]) * c;
  out[1] = a[1] + (b[1] - a[1]) * c;
  out[2] = a[2] + (b[2] - a[2]) * c;
  return out;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

interface Crater {
  x: number;
  y: number;
  z: number;
  radius: number;
  depth: number;
}

function generateCraters(seed: number, count: number): Crater[] {
  const craters: Crater[] = [];
  let s = (seed * 7919) >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const u = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - u * u));
    const size = Math.pow(rand(), 2.6);
    craters.push({
      x: r * Math.cos(phi),
      y: u,
      z: r * Math.sin(phi),
      radius: 0.035 + size * 0.22,
      depth: 0.14 + size * 0.35,
    });
  }
  return craters;
}

function createCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D, ImageData] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  return [canvas, ctx, img];
}

function finalizeTexture(
  canvas: HTMLCanvasElement,
  isColor: boolean,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates deterministic, seamless spherical-3D equirectangular PBR maps for any Solar System body.
 */
export function buildPlanetTextures(
  recipe: PlanetVisualRecipe,
  maxAnisotropy: number,
  highRes = false,
): PlanetTextureSet {
  const width = highRes ? 768 : 256;
  const height = highRes ? 384 : 128;

  const perm = buildPermTable(recipe.seed);
  const permDetail = buildPermTable(recipe.seed + 137);
  const [albedoCanvas, albedoCtx, albedoImg] = createCanvas(width, height);
  const [normalCanvas, normalCtx, normalImg] = createCanvas(width, height);

  let roughCanvas: HTMLCanvasElement | undefined;
  let roughCtx: CanvasRenderingContext2D | undefined;
  let roughImg: ImageData | undefined;
  if (recipe.kind === 'earth' || recipe.kind === 'icy_moon') {
    [roughCanvas, roughCtx, roughImg] = createCanvas(width, height);
  }

  let cloudCanvas: HTMLCanvasElement | undefined;
  let cloudCtx: CanvasRenderingContext2D | undefined;
  let cloudImg: ImageData | undefined;
  if (recipe.hasClouds) {
    [cloudCanvas, cloudCtx, cloudImg] = createCanvas(width, height);
  }

  let nightCanvas: HTMLCanvasElement | undefined;
  let nightCtx: CanvasRenderingContext2D | undefined;
  let nightImg: ImageData | undefined;
  if (recipe.hasNightLights) {
    [nightCanvas, nightCtx, nightImg] = createCanvas(width, height);
  }

  const heightBuffer = new Float32Array(width * height);
  const albedoData = albedoImg.data;

  const baseRgb = hexToRgb(recipe.baseColor);
  const secRgb = hexToRgb(recipe.secondaryColor);
  const accRgb = hexToRgb(recipe.accentColor ?? recipe.baseColor);

  const craters =
    recipe.kind === 'mercury' ||
    recipe.kind === 'moon' ||
    recipe.kind === 'mars' ||
    recipe.kind === 'rocky_moon' ||
    recipe.kind === 'pluto'
      ? generateCraters(recipe.seed, recipe.kind === 'mars' ? 42 : 75)
      : [];

  // Precompute trig lookup tables per row/column for fast 3D unit sphere mapping
  const cosPhi = new Float32Array(width);
  const sinPhi = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const phi = (x / width) * Math.PI * 2;
    cosPhi[x] = Math.cos(phi);
    sinPhi[x] = Math.sin(phi);
  }

  const octaves = highRes ? 5 : 4;

  const rgbScratch: [number, number, number] = [0, 0, 0];
  const rgbScratchB: [number, number, number] = [0, 0, 0];

  for (let y = 0; y < height; y++) {
    const theta = ((y + 0.5) / height) * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta); // +1 north pole -> -1 south pole
    const lat = Math.abs(cosTheta);

    for (let x = 0; x < width; x++) {
      const nx = sinTheta * cosPhi[x];
      const ny = cosTheta;
      const nz = sinTheta * sinPhi[x];
      const idx = y * width + x;
      const p4 = idx * 4;

      let rgb: [number, number, number] = baseRgb;
      let hVal = 0.5;
      let roughVal = Math.round(recipe.roughness * 255);

      if (recipe.kind === 'earth') {
        const cont = fbm3(perm, nx * 2.1, ny * 2.1, nz * 2.1, octaves);
        const ridge = ridgedFbm3(permDetail, nx * 5.2, ny * 5.2, nz * 5.2, 4);
        const moisture = fbm3(permDetail, nx * 3.4 + 4.1, ny * 3.4, nz * 3.4, 3);
        const elevation = cont * 0.78 + ridge * 0.22;
        const iceMask = smoothstep(0.76, 0.9, lat + (cont - 0.5) * 0.14);

        const seaLevel = 0.505;
        if (iceMask > 0.5) {
          rgb = mixRgb([216, 232, 245], [248, 252, 255], iceMask, rgbScratch);
          hVal = 0.62;
          roughVal = 115;
        } else if (elevation < seaLevel) {
          const depth = smoothstep(0.28, seaLevel, elevation);
          rgb = mixRgb([8, 32, 76], [28, 108, 166], depth, rgbScratch);
          hVal = 0.45;
          roughVal = 58; // Glossy ocean glint
        } else {
          const landAlt = smoothstep(seaLevel, 0.88, elevation);
          const arid = smoothstep(0.45, 0.78, moisture) * (1 - smoothstep(0.38, 0.65, lat));
          const landColor = mixRgb([38, 106, 56], [176, 148, 98], arid, rgbScratch);
          // Tundra / highlands
          mixRgb(landColor, [94, 110, 82], smoothstep(0.55, 0.8, lat), landColor);
          mixRgb(landColor, [145, 138, 128], smoothstep(0.55, 0.85, landAlt), landColor);
          mixRgb(landColor, [242, 246, 250], smoothstep(0.84, 0.96, landAlt), landColor);
          rgb = landColor;
          hVal = 0.5 + landAlt * 0.45;
          roughVal = 215;

          // Coastal & temperate city lights on night side
          if (nightImg) {
            const coast = 1 - smoothstep(0, 0.18, landAlt);
            const cluster = fbm3(permDetail, nx * 18, ny * 18, nz * 18, 3);
            const pop =
              coast *
              smoothstep(0.56, 0.8, cluster) *
              (1 - smoothstep(0.55, 0.78, lat));
            const glow = Math.min(255, Math.round(pop * 255));
            nightImg.data[p4] = glow;
            nightImg.data[p4 + 1] = Math.round(glow * 0.78);
            nightImg.data[p4 + 2] = Math.round(glow * 0.42);
            nightImg.data[p4 + 3] = 255;
          }
        }

        if (cloudImg) {
          const warp = fbm3(perm, nx * 2.5 + 8.3, ny * 2.5, nz * 2.5, 3);
          const swirl = fbm3(
            permDetail,
            nx * 4.2 + warp * 1.4,
            ny * 4.8,
            nz * 4.2 - warp * 1.1,
            4,
          );
          const cloudAlpha = smoothstep(0.49, 0.74, swirl);
          cloudImg.data[p4] = 250;
          cloudImg.data[p4 + 1] = 252;
          cloudImg.data[p4 + 2] = 255;
          cloudImg.data[p4 + 3] = Math.round(cloudAlpha * 240);
        }
      } else if (
        recipe.kind === 'jupiter' ||
        recipe.kind === 'saturn' ||
        recipe.kind === 'uranus' ||
        recipe.kind === 'neptune'
      ) {
        const bandFreq =
          recipe.kind === 'jupiter' ? 14.0 : recipe.kind === 'saturn' ? 16.0 : 7.0;
        const turbScale = recipe.kind === 'jupiter' ? 0.24 : recipe.kind === 'neptune' ? 0.18 : 0.1;
        const turb = fbm3(perm, nx * 3.6, ny * 5.2, nz * 3.6, octaves) - 0.5;
        const fineTurb = fbm3(permDetail, nx * 9.0 + turb * 2.0, ny * 14.0, nz * 9.0, 3);
        const bandCoord = ny * bandFreq + turb * bandFreq * turbScale;
        const bandWave = Math.sin(bandCoord) * 0.5 + 0.5;
        const zone = Math.cos(bandCoord * 0.48 + 1.2) * 0.5 + 0.5;

        rgb = mixRgb(secRgb, baseRgb, bandWave, rgbScratch);
        mixRgb(rgb, accRgb, zone * 0.48 + (fineTurb - 0.5) * 0.3, rgb);

        // Jupiter Great Red Spot
        if (recipe.kind === 'jupiter') {
          const spotX = nx - 0.72;
          const spotY = (ny + 0.36) * 1.85;
          const spotZ = nz - 0.58;
          const d = Math.sqrt(spotX * spotX + spotY * spotY + spotZ * spotZ);
          if (d < 0.26) {
            const spotMask = smoothstep(0.26, 0.05, d);
            const swirlRing = Math.sin(d * 48) * 0.12 + 0.5;
            const spotCol = mixRgb([196, 78, 48], [232, 134, 82], swirlRing, rgbScratchB);
            mixRgb(rgb, spotCol, spotMask * 0.9, rgb);
          }
        }

        // Neptune high-altitude bright methane streaks
        if (recipe.kind === 'neptune') {
          const streak = smoothstep(0.68, 0.84, fineTurb * (1 - Math.abs(ny) * 0.4));
          mixRgb(rgb, [175, 212, 255], streak * 0.55, rgb);
        }

        hVal = 0.5 + (bandWave - 0.5) * 0.08 + (fineTurb - 0.5) * 0.06;
      } else if (recipe.kind === 'venus' || recipe.kind === 'hazy_moon') {
        const chevron = fbm3(perm, nx * 2.5 + ny * ny * 1.2, ny * 3.8, nz * 2.5, octaves);
        const wisps = fbm3(permDetail, nx * 5.2 + chevron, ny * 6.5, nz * 5.2, 4);
        rgb = mixRgb(secRgb, baseRgb, smoothstep(0.25, 0.75, chevron), rgbScratch);
        mixRgb(rgb, accRgb, smoothstep(0.55, 0.85, wisps) * 0.55, rgb);
        hVal = 0.5 + (wisps - 0.5) * 0.08;

        if (cloudImg) {
          cloudImg.data[p4] = Math.round(accRgb[0]);
          cloudImg.data[p4 + 1] = Math.round(accRgb[1]);
          cloudImg.data[p4 + 2] = Math.round(accRgb[2]);
          cloudImg.data[p4 + 3] = Math.round(smoothstep(0.32, 0.8, wisps) * 215);
        }
      } else if (recipe.kind === 'volcanic_moon') {
        const flow = fbm3(perm, nx * 3.5, ny * 3.5, nz * 3.5, octaves);
        const caldera = ridgedFbm3(permDetail, nx * 7.5, ny * 7.5, nz * 7.5, 4);
        rgb = mixRgb(baseRgb, secRgb, smoothstep(0.35, 0.72, flow), rgbScratch);
        const darkPit = smoothstep(0.66, 0.85, caldera);
        mixRgb(rgb, accRgb, darkPit * 0.85, rgb);
        hVal = 0.5 + (flow - 0.5) * 0.3 - darkPit * 0.22;
      } else if (recipe.kind === 'icy_moon') {
        const terrain = fbm3(perm, nx * 3.0, ny * 3.0, nz * 3.0, octaves);
        const lineae = 1 - Math.abs(noise3(permDetail, nx * 9.5 + terrain * 1.5, ny * 9.5, nz * 9.5) * 2 - 1);
        const crack = smoothstep(0.84, 0.98, lineae);
        rgb = mixRgb(baseRgb, accRgb, terrain * 0.6, rgbScratch);
        mixRgb(rgb, secRgb, crack * 0.78, rgb);
        hVal = 0.52 + (terrain - 0.5) * 0.14 - crack * 0.25;
        roughVal = Math.round((0.28 + crack * 0.45) * 255);
      } else {
        // Rocky cratered bodies: Mercury, Moon, Mars, Pluto, Rocky Moons
        const macro = fbm3(perm, nx * 2.4, ny * 2.4, nz * 2.4, octaves);
        const micro = ridgedFbm3(permDetail, nx * 8.0, ny * 8.0, nz * 8.0, 4);
        let elev = macro * 0.72 + micro * 0.28;

        // Apply deterministic craters
        let craterRim = 0;
        for (let c = 0; c < craters.length; c++) {
          const cr = craters[c];
          const dx = nx - cr.x;
          const dy = ny - cr.y;
          const dz = nz - cr.z;
          const dSq = dx * dx + dy * dy + dz * dz;
          const rSq = cr.radius * cr.radius;
          if (dSq < rSq * 1.65) {
            const d = Math.sqrt(dSq) / cr.radius;
            if (d < 0.85) {
              const bowl = 1 - (d / 0.85) * (d / 0.85);
              elev -= bowl * cr.depth;
            } else if (d < 1.28) {
              const rim = Math.sin(((d - 0.85) / 0.43) * Math.PI);
              elev += rim * cr.depth * 0.42;
              craterRim = Math.max(craterRim, rim);
            }
          }
        }

        if (recipe.kind === 'mars') {
          const basin = smoothstep(0.32, 0.68, elev);
          rgb = mixRgb(secRgb, baseRgb, basin, rgbScratch);
          mixRgb(rgb, accRgb, smoothstep(0.65, 0.92, elev) * 0.75, rgb);
          // Mars polar ice caps
          const polar = smoothstep(0.86, 0.95, lat + (macro - 0.5) * 0.08);
          mixRgb(rgb, [242, 240, 238], polar, rgb);
        } else if (recipe.kind === 'pluto') {
          rgb = mixRgb(secRgb, baseRgb, smoothstep(0.3, 0.7, elev), rgbScratch);
          // Sputnik Planitia bright nitrogen-ice heart region
          const heartDist = Math.hypot(nx - 0.65, (ny + 0.08) * 1.2, nz - 0.45);
          const heartMask = smoothstep(0.5, 0.2, heartDist);
          mixRgb(rgb, accRgb, heartMask * 0.92, rgb);
        } else {
          // Mercury / Moon / rocky moons
          rgb = mixRgb(secRgb, baseRgb, smoothstep(0.28, 0.68, elev), rgbScratch);
          mixRgb(rgb, accRgb, Math.max(craterRim * 0.65, smoothstep(0.68, 0.92, elev) * 0.5), rgb);
        }

        hVal = Math.max(0, Math.min(1, elev));
      }

      albedoData[p4] = Math.max(0, Math.min(255, Math.round(rgb[0])));
      albedoData[p4 + 1] = Math.max(0, Math.min(255, Math.round(rgb[1])));
      albedoData[p4 + 2] = Math.max(0, Math.min(255, Math.round(rgb[2])));
      albedoData[p4 + 3] = 255;

      heightBuffer[idx] = hVal;
      if (roughImg) {
        roughImg.data[p4] = roughVal;
        roughImg.data[p4 + 1] = roughVal;
        roughImg.data[p4 + 2] = roughVal;
        roughImg.data[p4 + 3] = 255;
      }
    }
  }

  // Convert heightBuffer into tangent-space normal map
  const nData = normalImg.data;
  const strength =
    recipe.kind === 'jupiter' ||
    recipe.kind === 'saturn' ||
    recipe.kind === 'uranus' ||
    recipe.kind === 'neptune' ||
    recipe.kind === 'venus'
      ? 1.1
      : 3.4;

  for (let y = 0; y < height; y++) {
    const yUp = Math.max(0, y - 1);
    const yDn = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const xLt = (x - 1 + width) % width;
      const xRt = (x + 1) % width;

      const hL = heightBuffer[y * width + xLt];
      const hR = heightBuffer[y * width + xRt];
      const hU = heightBuffer[yUp * width + x];
      const hD = heightBuffer[yDn * width + x];

      const dx = (hL - hR) * strength;
      const dy = (hU - hD) * strength;
      const dz = 1.0;
      const len = Math.hypot(dx, dy, dz);

      const p4 = (y * width + x) * 4;
      nData[p4] = Math.round(((dx / len) * 0.5 + 0.5) * 255);
      nData[p4 + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
      nData[p4 + 2] = Math.round(((dz / len) * 0.5 + 0.5) * 255);
      nData[p4 + 3] = 255;
    }
  }

  albedoCtx.putImageData(albedoImg, 0, 0);
  normalCtx.putImageData(normalImg, 0, 0);

  const result: PlanetTextureSet = {
    albedoMap: finalizeTexture(albedoCanvas, true, maxAnisotropy),
    normalMap: finalizeTexture(normalCanvas, false, maxAnisotropy),
    resolutionTier: highRes ? 'high' : 'base',
  };

  if (roughCanvas && roughCtx && roughImg) {
    roughCtx.putImageData(roughImg, 0, 0);
    result.roughnessMap = finalizeTexture(roughCanvas, false, maxAnisotropy);
  }

  if (cloudCanvas && cloudCtx && cloudImg) {
    cloudCtx.putImageData(cloudImg, 0, 0);
    result.cloudMap = finalizeTexture(cloudCanvas, true, maxAnisotropy);
  }

  if (nightCanvas && nightCtx && nightImg) {
    nightCtx.putImageData(nightImg, 0, 0);
    result.nightLightsMap = finalizeTexture(nightCanvas, true, maxAnisotropy);
  }

  if (recipe.rings) {
    result.ringMap = buildRingTexture(recipe, maxAnisotropy);
  }

  return result;
}

export function buildRingTexture(
  recipe: PlanetVisualRecipe,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const rings = recipe.rings!;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, 16);

  const colA = hexToRgb(rings.colorA);
  const colB = hexToRgb(rings.colorB);

  let s = (recipe.seed * 3571) >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const ringlets = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1);
    let density = 0;

    if (recipe.kind === 'saturn') {
      // C ring (faint inner), B ring (bright dense), Cassini Division, A ring + Encke gap
      const cRing = smoothstep(0.02, 0.18, t) * (1 - smoothstep(0.24, 0.28, t)) * 0.32;
      const bRing = smoothstep(0.26, 0.3, t) * (1 - smoothstep(0.6, 0.63, t)) * 0.96;
      const aRing = smoothstep(0.68, 0.71, t) * (1 - smoothstep(0.95, 0.99, t)) * 0.72;
      const enckeGap = 1 - smoothstep(0.015, 0.0, Math.abs(t - 0.87));
      density = Math.max(cRing, bRing, aRing * enckeGap);
      // Fine concentric ringlets
      density *= 0.76 + 0.24 * Math.sin(t * 210 + rand() * 0.4);
    } else {
      // Uranus narrow dark icy rings
      const bands = [0.22, 0.38, 0.56, 0.74, 0.88];
      for (const b of bands) {
        const w = Math.exp(-Math.pow((t - b) / 0.025, 2));
        density = Math.max(density, w * 0.75);
      }
    }
    ringlets[i] = Math.max(0, Math.min(1, density));
  }

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < size; x++) {
      const t = x / (size - 1);
      const col = mixRgb(colB, colA, 0.5 + 0.5 * Math.sin(t * 95));
      const p4 = (y * size + x) * 4;
      img.data[p4] = Math.round(col[0]);
      img.data[p4 + 1] = Math.round(col[1]);
      img.data[p4 + 2] = Math.round(col[2]);
      img.data[p4 + 3] = Math.round(ringlets[x] * rings.opacity * 255);
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Lightweight standalone cloud map generator for Earth so we don't have to generate a procedural Earth albedo.
 */
export function buildEarthCloudTexture(
  seed: number,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const width = 768;
  const height = 384;
  const perm = buildPermTable(seed);
  const permDetail = buildPermTable(seed + 137);
  const [canvas, ctx, img] = createCanvas(width, height);

  const cosPhi = new Float32Array(width);
  const sinPhi = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const phi = (x / width) * Math.PI * 2;
    cosPhi[x] = Math.cos(phi);
    sinPhi[x] = Math.sin(phi);
  }

  for (let y = 0; y < height; y++) {
    const theta = ((y + 0.5) / height) * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    for (let x = 0; x < width; x++) {
      const nx = sinTheta * cosPhi[x];
      const ny = cosTheta;
      const nz = sinTheta * sinPhi[x];
      const warp = fbm3(perm, nx * 2.5 + 8.3, ny * 2.5, nz * 2.5, 3);
      const swirl = fbm3(
        permDetail,
        nx * 4.2 + warp * 1.4,
        ny * 4.8,
        nz * 4.2 - warp * 1.1,
        4,
      );
      const cloudAlpha = smoothstep(0.5, 0.75, swirl);
      const p4 = (y * width + x) * 4;
      img.data[p4] = 250;
      img.data[p4 + 1] = 252;
      img.data[p4 + 2] = 255;
      img.data[p4 + 3] = Math.round(cloudAlpha * 235);
    }
  }

  ctx.putImageData(img, 0, 0);
  return finalizeTexture(canvas, true, maxAnisotropy);
}

/**
 * Derives aligned ocean-specular roughness and coastal/continental city-light masks
 * directly from the loaded Blue Marble equirectangular Earth texture (optimized 512x256 pass).
 */
export function deriveEarthMasksFromImage(
  image: CanvasImageSource,
  maxAnisotropy: number,
  includeNightMap = true,
): { roughnessMap: THREE.CanvasTexture; nightLightsMap?: THREE.CanvasTexture } {
  const width = 1024;
  const height = 512;

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.drawImage(image, 0, 0, width, height);
  const srcData = srcCtx.getImageData(0, 0, width, height).data;

  const [roughCanvas, roughCtx, roughImg] = createCanvas(width, height);
  const nightBundle = includeNightMap ? createCanvas(width, height) : null;
  const perm = includeNightMap ? buildPermTable(422 + 99) : null;

  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    const lat = Math.abs(v * 2 - 1);
    const theta = v * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const p4 = idx * 4;
      const r = srcData[p4];
      const g = srcData[p4 + 1];
      const b = srcData[p4 + 2];

      const isIce = r > 185 && g > 185 && b > 185;
      const isWater = !isIce && b > r + 14 && r < 70 && g < 120;

      // Broad natural ocean sun-glint sheen (roughness ~0.44) vs matte terrain (~0.93)
      const roughVal = isWater ? 112 : isIce ? 148 : 238;
      roughImg.data[p4] = roughVal;
      roughImg.data[p4 + 1] = roughVal;
      roughImg.data[p4 + 2] = roughVal;
      roughImg.data[p4 + 3] = 255;

      if (nightBundle && perm) {
        const nightImg = nightBundle[2];
        if (!isWater && !isIce && lat < 0.74) {
          const phi = (x / width) * Math.PI * 2;
          const nx = sinTheta * Math.cos(phi);
          const ny = cosTheta;
          const nz = sinTheta * Math.sin(phi);
          const cluster = fbm3(perm, nx * 20, ny * 20, nz * 20, 2);
          const fine = noise3(perm, nx * 60, ny * 60, nz * 60);
          const latWeight = 1 - smoothstep(0.55, 0.74, lat);
          const city = smoothstep(0.52, 0.76, cluster) * smoothstep(0.42, 0.78, fine) * latWeight;
          const glow = Math.min(255, Math.round(city * 255));
          nightImg.data[p4] = glow;
          nightImg.data[p4 + 1] = Math.round(glow * 0.76);
          nightImg.data[p4 + 2] = Math.round(glow * 0.40);
          nightImg.data[p4 + 3] = 255;
        } else {
          nightImg.data[p4 + 3] = 255;
        }
      }
    }
  }

  roughCtx.putImageData(roughImg, 0, 0);
  if (nightBundle) {
    nightBundle[1].putImageData(nightBundle[2], 0, 0);
  }

  return {
    roughnessMap: finalizeTexture(roughCanvas, false, maxAnisotropy),
    nightLightsMap: nightBundle
      ? finalizeTexture(nightBundle[0], true, maxAnisotropy)
      : undefined,
  };
}

/**
 * Converts a grayscale equirectangular elevation DEM (such as NASA LRO LOLA Moon DEM)
 * into a scale-invariant tangent-space normal map so surface relief remains crisp at any scale.
 */
export function buildNormalMapFromHeightImage(
  image: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number },
  maxAnisotropy: number,
  strength = 2.8,
  oceanMaskImage?: CanvasImageSource | null,
  noiseFloor = 0,
): THREE.CanvasTexture {
  const natW = image.naturalWidth ?? image.width ?? 1024;
  const natH = image.naturalHeight ?? image.height ?? 512;
  const width = Math.min(2048, Math.max(256, natW));
  const height = Math.min(1024, Math.max(128, natH));

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.drawImage(image, 0, 0, width, height);
  const srcData = srcCtx.getImageData(0, 0, width, height).data;

  let waterMask: Uint8Array | null = null;
  if (oceanMaskImage) {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d')!;
    maskCtx.drawImage(oceanMaskImage, 0, 0, width, height);
    const maskData = maskCtx.getImageData(0, 0, width, height).data;
    waterMask = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const p4 = i * 4;
      const r = maskData[p4];
      const g = maskData[p4 + 1];
      const b = maskData[p4 + 2];
      const isIce = r > 185 && g > 185 && b > 185;
      if (!isIce && b > r + 10 && b >= g - 4 && r < 85 && g < 165) {
        waterMask[i] = 1;
      }
    }
  }

  const heights = new Float32Array(width * height);
  const invFloorSpan = noiseFloor > 0 ? 1 / Math.max(1, 255 - noiseFloor) : 1 / 255;
  for (let i = 0; i < width * height; i++) {
    if (waterMask && waterMask[i] === 1) {
      heights[i] = 0;
      continue;
    }
    const raw = srcData[i * 4];
    heights[i] = raw <= noiseFloor ? 0 : (raw - noiseFloor) * invFloorSpan;
  }

  const [normalCanvas, normalCtx, normalImg] = createCanvas(width, height);
  const nData = normalImg.data;

  for (let y = 0; y < height; y++) {
    const yUp = Math.max(0, y - 1);
    const yDn = Math.min(height - 1, y + 1);
    const rowOff = y * width;
    const rowUp = yUp * width;
    const rowDn = yDn * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOff + x;
      const p4 = idx * 4;

      if (waterMask && waterMask[idx] === 1) {
        nData[p4] = 128;
        nData[p4 + 1] = 128;
        nData[p4 + 2] = 255;
        nData[p4 + 3] = 255;
        continue;
      }

      const xLt = (x - 1 + width) % width;
      const xRt = (x + 1) % width;

      const hL = heights[rowOff + xLt];
      const hR = heights[rowOff + xRt];
      const hU = heights[rowUp + x];
      const hD = heights[rowDn + x];

      const dx = (hL - hR) * strength;
      const dy = (hD - hU) * strength;
      const dz = 1.0;
      const len = Math.hypot(dx, dy, dz);

      nData[p4] = ((dx / len) * 127.5 + 128) | 0;
      nData[p4 + 1] = ((dy / len) * 127.5 + 128) | 0;
      nData[p4 + 2] = ((dz / len) * 127.5 + 128) | 0;
      nData[p4 + 3] = 255;
    }
  }

  normalCtx.putImageData(normalImg, 0, 0);
  return finalizeTexture(normalCanvas, false, maxAnisotropy);
}
