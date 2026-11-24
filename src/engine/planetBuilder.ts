import * as THREE from 'three';
import { CelestialBodyData } from '../types/astronomy';
import {
  buildEarthCloudTexture,
  buildNormalMapFromHeightImage,
  buildPlanetTextures,
  buildRingTexture,
  deriveEarthMasksFromImage,
  PlanetTextureSet,
} from './proceduralTextures';
import {
  AtmosphereShaderConfig,
  attachRteLineBeforeRender,
  createAtmosphereMaterial,
  createAtmosphereVeilMaterial,
  createPrecisionLineMaterial,
  createRteLineGeometry,
  createSunCoronaMaterial,
  createSunSurfaceMaterial,
} from './shaders';

export interface PlanetNode {
  data: CelestialBodyData;
  orbitPivot: THREE.Group;
  equatorialGroup: THREE.Group;
  tiltGroup: THREE.Group;
  surfaceMesh: THREE.Mesh;
  cloudMesh?: THREE.Mesh;
  atmosphereMesh?: THREE.Mesh;
  atmosphereMat?: THREE.ShaderMaterial;
  atmosphereScale?: number;
  atmosphereVeilMesh?: THREE.Mesh;
  atmosphereVeilMat?: THREE.ShaderMaterial;
  atmosphereVeilScale?: number;
  ringMesh?: THREE.Mesh;
  ringMat?: THREE.MeshStandardMaterial;
  sunCoronaMesh?: THREE.Mesh;
  sunSurfaceMat?: THREE.ShaderMaterial;
  sunCoronaMat?: THREE.ShaderMaterial;
  hitProxy: THREE.Mesh;
  orbitLine?: THREE.LineLoop;
  textures?: PlanetTextureSet;
  externalTexture?: THREE.Texture;
  externalCloudTexture?: THREE.Texture;
  externalNightTexture?: THREE.Texture;
  externalHeightNormalTexture?: THREE.Texture;
  hasExternalTexture?: boolean;
  isUpgradingHighRes?: boolean;
  surfaceMat?: THREE.MeshStandardMaterial;
  cloudMat?: THREE.MeshStandardMaterial;
}

const SHARED_SPHERE_HIGH = new THREE.SphereGeometry(1, 96, 64);
const SHARED_SPHERE_MED = new THREE.SphereGeometry(1, 48, 32);
const SHARED_SPHERE_LOW = new THREE.SphereGeometry(1, 28, 18);
const SHARED_HIT_SPHERE = new THREE.SphereGeometry(1, 14, 10);
const TEXTURE_LOADER = new THREE.TextureLoader();

const _ringCenter = new THREE.Vector3();
const _ringNormal = new THREE.Vector3();
const _ringQuat = new THREE.Quaternion();

const _normalMapQueue: Array<() => void> = [];
let _normalMapRaf = 0;
function enqueueNormalMapBuild(task: () => void): void {
  _normalMapQueue.push(task);
  if (_normalMapRaf) return;
  const step = () => {
    const next = _normalMapQueue.shift();
    if (next) next();
    if (_normalMapQueue.length > 0) {
      _normalMapRaf = requestAnimationFrame(step);
    } else {
      _normalMapRaf = 0;
    }
  };
  _normalMapRaf = requestAnimationFrame(step);
}

interface PlanetAtmospherePreset {
  atmoScale: number;
  veilScale: number;
  config: AtmosphereShaderConfig;
}

function getAtmospherePreset(
  kind: CelestialBodyData['visual']['kind'],
  fallbackHex: string,
  fallbackIntensity: number,
): PlanetAtmospherePreset {
  switch (kind) {
    case 'earth':
      return {
        atmoScale: 1.024,
        veilScale: 1.0045,
        config: {
          innerColor: '#D4E6FA',
          outerColor: '#6AA4E8',
          terminatorColor: '#E89B72',
          planetRatio: 1 / 1.024,
          falloff: 5.4,
          haloStrength: 0.68,
          veilStrength: 0.56,
          forwardScatter: 0.72,
        },
      };
    case 'mars':
      return {
        atmoScale: 1.026,
        veilScale: 1.003,
        config: {
          innerColor: '#E8A882',
          outerColor: '#C97B59',
          terminatorColor: '#8FB8EC', // Realistic Martian blue dust twilight
          planetRatio: 1 / 1.026,
          falloff: 6.0,
          haloStrength: 0.46,
          veilStrength: 0.24,
          forwardScatter: 0.58,
        },
      };
    case 'venus':
      return {
        atmoScale: 1.044,
        veilScale: 1.004,
        config: {
          innerColor: '#F7E4BA',
          outerColor: '#DEB26A',
          terminatorColor: '#F2AE6E',
          planetRatio: 1 / 1.044,
          falloff: 4.5,
          haloStrength: 0.62,
          veilStrength: 0.34,
          forwardScatter: 0.88,
        },
      };
    case 'hazy_moon': // Titan thick golden smog + detached upper blue haze
      return {
        atmoScale: 1.095,
        veilScale: 1.008,
        config: {
          innerColor: '#F2B45C',
          outerColor: '#86A8D8',
          terminatorColor: '#F59E42',
          planetRatio: 1 / 1.095,
          falloff: 3.7,
          haloStrength: 0.78,
          veilStrength: 0.46,
          forwardScatter: 1.15,
        },
      };
    case 'jupiter':
      return {
        atmoScale: 1.02,
        veilScale: 1.003,
        config: {
          innerColor: '#EBD9BE',
          outerColor: '#BFA582',
          terminatorColor: '#D19560',
          planetRatio: 1 / 1.02,
          falloff: 6.8,
          haloStrength: 0.28,
          veilStrength: 0.16,
          forwardScatter: 0.35,
        },
      };
    case 'saturn':
      return {
        atmoScale: 1.022,
        veilScale: 1.003,
        config: {
          innerColor: '#EDE0BE',
          outerColor: '#C8B388',
          terminatorColor: '#D8A86C',
          planetRatio: 1 / 1.022,
          falloff: 6.4,
          haloStrength: 0.32,
          veilStrength: 0.18,
          forwardScatter: 0.4,
        },
      };
    case 'uranus':
      return {
        atmoScale: 1.032,
        veilScale: 1.003,
        config: {
          innerColor: '#9CEBF2',
          outerColor: '#5AB8CC',
          terminatorColor: '#68AFC4',
          planetRatio: 1 / 1.032,
          falloff: 5.4,
          haloStrength: 0.52,
          veilStrength: 0.3,
          forwardScatter: 0.5,
        },
      };
    case 'neptune':
      return {
        atmoScale: 1.034,
        veilScale: 1.003,
        config: {
          innerColor: '#7EB2FF',
          outerColor: '#2E64E0',
          terminatorColor: '#4A7FE0',
          planetRatio: 1 / 1.034,
          falloff: 5.2,
          haloStrength: 0.58,
          veilStrength: 0.34,
          forwardScatter: 0.55,
        },
      };
    case 'pluto':
      return {
        atmoScale: 1.072,
        veilScale: 1.003,
        config: {
          innerColor: '#A0CDFF',
          outerColor: '#4F85D6',
          terminatorColor: '#7AA8E8',
          planetRatio: 1 / 1.072,
          falloff: 4.1,
          haloStrength: 0.54,
          veilStrength: 0.16,
          forwardScatter: 1.05,
        },
      };
    default:
      return {
        atmoScale: 1.032,
        veilScale: 1.004,
        config: {
          innerColor: fallbackHex,
          outerColor: fallbackHex,
          terminatorColor: fallbackHex,
          planetRatio: 1 / 1.032,
          falloff: 5.2,
          haloStrength: fallbackIntensity * 0.75,
          veilStrength: fallbackIntensity * 0.38,
          forwardScatter: 0.55,
        },
      };
  }
}

export function createPlanetNode(
  body: CelestialBodyData,
  maxAnisotropy: number,
  clickableMeshes: THREE.Object3D[],
  deferProcedural = false,
): PlanetNode {
  const orbitPivot = new THREE.Group();
  orbitPivot.name = `pivot-${body.id}`;

  const equatorialGroup = new THREE.Group();
  equatorialGroup.rotation.z = THREE.MathUtils.degToRad(body.axialTiltDeg);
  orbitPivot.add(equatorialGroup);

  const tiltGroup = new THREE.Group();
  tiltGroup.rotation.z = THREE.MathUtils.degToRad(body.axialTiltDeg);
  orbitPivot.add(tiltGroup);

  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitProxy = new THREE.Mesh(SHARED_HIT_SPHERE, hitMat);
  hitProxy.layers.set(1);
  hitProxy.userData = { targetId: body.id, kind: 'celestial' };
  orbitPivot.add(hitProxy);
  clickableMeshes.push(hitProxy);

  if (body.visual.kind === 'sun') {
    const sunSurfaceMat = createSunSurfaceMaterial();
    const surfaceMesh = new THREE.Mesh(SHARED_SPHERE_HIGH, sunSurfaceMat);
    tiltGroup.add(surfaceMesh);

    const sunCoronaMat = createSunCoronaMaterial();
    const sunCoronaMesh = new THREE.Mesh(SHARED_SPHERE_MED, sunCoronaMat);
    sunCoronaMesh.scale.setScalar(1.36);
    tiltGroup.add(sunCoronaMesh);

    return {
      data: body,
      orbitPivot,
      equatorialGroup,
      tiltGroup,
      surfaceMesh,
      sunCoronaMesh,
      sunSurfaceMat,
      sunCoronaMat,
      hitProxy,
    };
  }

  const hasExternal = Boolean(body.visual.textureUrl);
  // Skip expensive procedural noise synthesis for external-texture bodies or deferred queue items
  const textures =
    hasExternal || deferProcedural
      ? undefined
      : buildPlanetTextures(body.visual, maxAnisotropy, false);

  const sphereGeo =
    body.category === 'moon' && !hasExternal ? SHARED_SPHERE_MED : SHARED_SPHERE_HIGH;

  const surfaceMat = new THREE.MeshStandardMaterial({
    color: hasExternal || !textures ? new THREE.Color(body.visual.baseColor) : 0xffffff,
    map: textures?.albedoMap ?? null,
    normalMap: textures?.normalMap ?? null,
    normalScale: new THREE.Vector2(
      body.category === 'moon' ? 0.9 : 0.75,
      body.category === 'moon' ? 0.9 : 0.75,
    ),
    roughnessMap: textures?.roughnessMap ?? null,
    roughness: textures?.roughnessMap ? 1.0 : body.visual.roughness,
    metalness: body.visual.metalness,
    envMapIntensity: 0,
  });

  // Earth night-side city lights OR Saturn/Uranus analytical ring shadow on planet
  if (body.visual.hasNightLights) {
    surfaceMat.onBeforeCompile = (shader) => {
      const nightMap =
        (surfaceMat.userData.nightLightsMap as THREE.Texture | undefined) ??
        textures?.nightLightsMap ??
        null;
      shader.uniforms.uNightMap = { value: nightMap };
      shader.uniforms.uHasNightMap = { value: nightMap ? 1.0 : 0.0 };
      shader.uniforms.uSunPos = { value: new THREE.Vector3(0, 0, 0) };
      surfaceMat.userData.shader = shader;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vWorldNormalNight;
           varying vec3 vWorldPosNight;
           varying vec2 vNightUv;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vNightUv = uv;
           vWorldNormalNight = normalize(mat3(modelMatrix) * objectNormal);
           vWorldPosNight = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform sampler2D uNightMap;
           uniform float uHasNightMap;
           uniform vec3 uSunPos;
           varying vec3 vWorldNormalNight;
           varying vec3 vWorldPosNight;
           varying vec2 vNightUv;`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
           float eLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
           float eMin = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
           float isIceMask = smoothstep(0.42, 0.68, eMin);
           float isWaterMask = smoothstep(0.015, 0.11, diffuseColor.b - max(diffuseColor.r, diffuseColor.g * 0.90)) * (1.0 - smoothstep(0.26, 0.50, eLuma));
           float isLandMask = (1.0 - isWaterMask) * (1.0 - isIceMask);
           float isAridMask = isLandMask * smoothstep(-0.02, 0.10, diffuseColor.r - diffuseColor.g) * smoothstep(0.08, 0.34, eLuma);
           float isForestMask = isLandMask * smoothstep(-0.01, 0.05, diffuseColor.g - diffuseColor.r) * (1.0 - isAridMask);

           vec3 aridCol = diffuseColor.rgb * vec3(0.68, 0.53, 0.43);
           diffuseColor.rgb = mix(diffuseColor.rgb, aridCol, isAridMask);

           vec3 mutedForest = mix(diffuseColor.rgb, vec3(eLuma * 0.88, eLuma * 0.98, eLuma * 0.78), 0.36) * 0.62;
           diffuseColor.rgb = mix(diffuseColor.rgb, mutedForest, isForestMask);

           float otherLand = isLandMask * (1.0 - isAridMask) * (1.0 - isForestMask);
           diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.64, otherLand);

           vec3 trueOcean = mix(diffuseColor.rgb * 0.76, vec3(0.016, 0.058, 0.135), 0.32);
           diffuseColor.rgb = mix(diffuseColor.rgb, trueOcean, isWaterMask);

           diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.78, isIceMask);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           if (uHasNightMap > 0.5) {
             vec3 toSun = normalize(uSunPos - vWorldPosNight);
             float sunDot = dot(normalize(vWorldNormalNight), toSun);
             float nightMask = smoothstep(-0.05, -0.26, sunDot);
             vec3 nightTex = texture2D(uNightMap, vNightUv).rgb;
             float luma = dot(nightTex, vec3(0.299, 0.587, 0.114));
             float cityMask = smoothstep(0.008, 0.032, luma);
             vec3 cityGlow = nightTex * cityMask * nightMask * 1.55;
             totalEmissiveRadiance += cityGlow;
           }`,
        );
    };
  } else if (body.visual.rings) {
    // Analytical ring shadow cast onto Saturn / Uranus cloud bands (zero shadow-map pass!)
    const rings = body.visual.rings;
    surfaceMat.onBeforeCompile = (shader) => {
      shader.uniforms.uSunPos = { value: new THREE.Vector3(0, 0, 0) };
      shader.uniforms.uRingCenter = { value: new THREE.Vector3() };
      shader.uniforms.uRingNormal = { value: new THREE.Vector3(0, 1, 0) };
      shader.uniforms.uRingInner = { value: rings.innerFactor };
      shader.uniforms.uRingOuter = { value: rings.outerFactor };
      shader.uniforms.uRingShadowStrength = { value: Math.min(0.95, rings.opacity * 0.92) };
      surfaceMat.userData.ringShadowShader = shader;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vWorldPosPlanet;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vWorldPosPlanet = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform vec3 uSunPos;
           uniform vec3 uRingCenter;
           uniform vec3 uRingNormal;
           uniform float uRingInner;
           uniform float uRingOuter;
           uniform float uRingShadowStrength;
           varying vec3 vWorldPosPlanet;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           vec3 toSunP = normalize(uSunPos - vWorldPosPlanet);
           float denomP = dot(toSunP, uRingNormal);
           if (abs(denomP) > 0.001) {
             float tPlane = dot(uRingCenter - vWorldPosPlanet, uRingNormal) / denomP;
             if (tPlane > 0.0) {
               vec3 hitRing = vWorldPosPlanet + toSunP * tPlane;
               float distRing = length(hitRing - uRingCenter);
               float bandIn = smoothstep(uRingInner, uRingInner + (uRingOuter - uRingInner) * 0.08, distRing);
               float bandOut = 1.0 - smoothstep(uRingOuter - (uRingOuter - uRingInner) * 0.06, uRingOuter, distRing);
               float tNorm = (distRing - uRingInner) / max(0.0001, uRingOuter - uRingInner);
               // Subtle Cassini division gap around 0.645
               float cassiniGap = 1.0 - exp(-pow((tNorm - 0.645) / 0.032, 2.0)) * 0.8;
               float ringShadow = bandIn * bandOut * cassiniGap * uRingShadowStrength;
               diffuseColor.rgb *= (1.0 - ringShadow);
             }
           }`,
        );
    };
  }

  const surfaceMesh = new THREE.Mesh(sphereGeo, surfaceMat);
  surfaceMesh.castShadow = false;
  surfaceMesh.receiveShadow = false;
  tiltGroup.add(surfaceMesh);

  let cloudMesh: THREE.Mesh | undefined;
  let cloudMat: THREE.MeshStandardMaterial | undefined;
  let earthCloudTex: THREE.CanvasTexture | undefined;
  if (body.visual.hasClouds) {
    if (body.visual.cloudTextureUrl) {
      cloudMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(body.visual.cloudColor ?? '#FFFFFF'),
        transparent: true,
        opacity: body.visual.cloudOpacity ?? 0.94,
        alphaTest: 0.03,
        roughness: 0.96,
        metalness: 0.0,
        depthWrite: false,
        envMapIntensity: 0,
      });
      cloudMat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <alphamap_fragment>',
          `#include <alphamap_fragment>
           diffuseColor.a = pow(clamp(diffuseColor.a, 0.0, 1.0), 0.84) * smoothstep(0.03, 0.22, diffuseColor.a);
           diffuseColor.rgb *= 0.82;`,
        );
      };
      cloudMesh = new THREE.Mesh(SHARED_SPHERE_HIGH, cloudMat);
      cloudMesh.scale.setScalar(1.005);
      cloudMesh.visible = false;
      tiltGroup.add(cloudMesh);
    } else {
      const cloudMap =
        textures?.cloudMap ??
        (body.visual.kind === 'earth'
          ? (earthCloudTex = buildEarthCloudTexture(body.visual.seed, maxAnisotropy))
          : undefined);
      if (cloudMap) {
        cloudMat = new THREE.MeshStandardMaterial({
          map: cloudMap,
          transparent: true,
          opacity: body.visual.cloudOpacity ?? 0.56,
          roughness: 0.94,
          metalness: 0.0,
          depthWrite: false,
          envMapIntensity: 0,
        });
        cloudMesh = new THREE.Mesh(SHARED_SPHERE_MED, cloudMat);
        cloudMesh.scale.setScalar(1.005);
        tiltGroup.add(cloudMesh);
      }
    }
  }

  let atmosphereMesh: THREE.Mesh | undefined;
  let atmosphereMat: THREE.ShaderMaterial | undefined;
  let atmosphereScale: number | undefined;
  let atmosphereVeilMesh: THREE.Mesh | undefined;
  let atmosphereVeilMat: THREE.ShaderMaterial | undefined;
  let atmosphereVeilScale: number | undefined;
  if (body.visual.atmosphereColor) {
    const preset = getAtmospherePreset(
      body.visual.kind,
      body.visual.atmosphereColor,
      body.visual.atmosphereIntensity ?? 0.65,
    );
    atmosphereScale = preset.atmoScale;
    atmosphereVeilScale = preset.veilScale;

    atmosphereMat = createAtmosphereMaterial(preset.config);
    atmosphereMesh = new THREE.Mesh(SHARED_SPHERE_HIGH, atmosphereMat);
    atmosphereMesh.scale.setScalar(atmosphereScale);
    tiltGroup.add(atmosphereMesh);

    atmosphereVeilMat = createAtmosphereVeilMaterial(preset.config);
    atmosphereVeilMesh = new THREE.Mesh(SHARED_SPHERE_HIGH, atmosphereVeilMat);
    atmosphereVeilMesh.scale.setScalar(atmosphereVeilScale);
    tiltGroup.add(atmosphereVeilMesh);
  }

  let ringMesh: THREE.Mesh | undefined;
  let ringMat: THREE.MeshStandardMaterial | undefined;
  let externalRingMap: THREE.CanvasTexture | undefined;
  if (body.visual.rings) {
    const ringTex =
      textures?.ringMap ?? (externalRingMap = buildRingTexture(body.visual, maxAnisotropy));
    const inner = body.visual.rings.innerFactor;
    const outer = body.visual.rings.outerFactor;
    const ringGeo = new THREE.RingGeometry(inner, outer, 128, 1);
    const pos = ringGeo.attributes.position;
    const uv = ringGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const rad = Math.hypot(x, y);
      const t = (rad - inner) / (outer - inner);
      uv.setXY(i, t, 0.5);
    }
    ringGeo.rotateX(-Math.PI / 2);

    ringMat = new THREE.MeshStandardMaterial({
      map: ringTex,
      transparent: true,
      side: THREE.DoubleSide,
      roughness: 0.78,
      metalness: 0.02,
      depthWrite: false,
      envMapIntensity: 0,
    });

    // Analytical planet shadow cast across Saturn / Uranus rings
    ringMat.onBeforeCompile = (shader) => {
      shader.uniforms.uSunPos = { value: new THREE.Vector3(0, 0, 0) };
      shader.uniforms.uPlanetCenter = { value: new THREE.Vector3() };
      shader.uniforms.uPlanetRadius = { value: body.balancedRadius };
      ringMat!.userData.shadowShader = shader;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vWorldPosRing;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vWorldPosRing = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform vec3 uSunPos;
           uniform vec3 uPlanetCenter;
           uniform float uPlanetRadius;
           varying vec3 vWorldPosRing;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           vec3 toSunR = normalize(uSunPos - vWorldPosRing);
           vec3 oc = vWorldPosRing - uPlanetCenter;
           float proj = dot(oc, toSunR);
           if (proj < 0.0) {
             float perpDist = length(oc - toSunR * proj);
             float penumbra = smoothstep(uPlanetRadius * 0.97, uPlanetRadius * 1.03, perpDist);
             diffuseColor.rgb *= penumbra;
           }`,
        );
    };

    ringMesh = new THREE.Mesh(ringGeo, ringMat);
    tiltGroup.add(ringMesh);
  }

  const nodeTextures: PlanetTextureSet | undefined =
    textures ??
    (earthCloudTex || externalRingMap
      ? {
          albedoMap: earthCloudTex ?? externalRingMap!,
          normalMap: earthCloudTex ?? externalRingMap!,
          cloudMap: earthCloudTex,
          ringMap: externalRingMap,
          resolutionTier: 'high',
        }
      : undefined);

  const node: PlanetNode = {
    data: body,
    orbitPivot,
    equatorialGroup,
    tiltGroup,
    surfaceMesh,
    cloudMesh,
    atmosphereMesh,
    atmosphereMat,
    atmosphereScale,
    atmosphereVeilMesh,
    atmosphereVeilMat,
    atmosphereVeilScale,
    ringMesh,
    ringMat,
    hitProxy,
    textures: textures ? textures : nodeTextures,
    hasExternalTexture: hasExternal,
    surfaceMat,
    cloudMat,
  };

  type HeightImageSource = CanvasImageSource & {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  };
  let earthColorImage: CanvasImageSource | null = null;
  let earthHeightImage: HeightImageSource | null = null;

  const rebuildEarthNormalFromHeight = () => {
    if (!earthHeightImage) return;
    const normalTex = buildNormalMapFromHeightImage(
      earthHeightImage,
      maxAnisotropy,
      3.1,
      earthColorImage,
      18,
    );
    node.externalHeightNormalTexture?.dispose();
    surfaceMat.bumpMap = null;
    surfaceMat.normalMap = normalTex;
    surfaceMat.normalScale.set(0.85, 0.85);
    surfaceMat.needsUpdate = true;
    node.externalHeightNormalTexture = normalTex;
  };

  if (body.visual.textureUrl) {
    TEXTURE_LOADER.load(body.visual.textureUrl, (loadedTex) => {
      loadedTex.colorSpace = THREE.SRGBColorSpace;
      loadedTex.wrapS = THREE.RepeatWrapping;
      loadedTex.wrapT = THREE.ClampToEdgeWrapping;
      loadedTex.anisotropy = maxAnisotropy;
      loadedTex.generateMipmaps = true;
      loadedTex.needsUpdate = true;

      surfaceMat.color.setHex(0xffffff);
      surfaceMat.map = loadedTex;

      const kind = body.visual.kind;
      if ((kind === 'mercury' || kind === 'moon' || kind === 'mars') && !body.visual.heightTextureUrl) {
        surfaceMat.bumpMap = loadedTex;
        surfaceMat.bumpScale = kind === 'moon' ? 0.034 : 0.028;
      } else if (kind === 'earth' && !body.visual.heightTextureUrl) {
        surfaceMat.bumpMap = loadedTex;
        surfaceMat.bumpScale = 0.015;
      } else if (kind === 'venus') {
        surfaceMat.bumpMap = loadedTex;
        surfaceMat.bumpScale = 0.006;
      }

      if (kind === 'earth' && loadedTex.image) {
        earthColorImage = loadedTex.image;
        const useExternalNight = Boolean(body.visual.nightTextureUrl);
        const derived = deriveEarthMasksFromImage(
          loadedTex.image,
          maxAnisotropy,
          !useExternalNight,
        );
        surfaceMat.roughnessMap = derived.roughnessMap;
        surfaceMat.roughness = 1.0;
        if (!useExternalNight && derived.nightLightsMap) {
          surfaceMat.userData.nightLightsMap = derived.nightLightsMap;
        }
        if (node.textures) {
          node.textures.roughnessMap?.dispose();
          node.textures.roughnessMap = derived.roughnessMap;
          if (!useExternalNight && derived.nightLightsMap) {
            node.textures.nightLightsMap?.dispose();
            node.textures.nightLightsMap = derived.nightLightsMap;
          }
        }
        if (!useExternalNight && derived.nightLightsMap && surfaceMat.userData.shader) {
          surfaceMat.userData.shader.uniforms.uNightMap.value = derived.nightLightsMap;
          surfaceMat.userData.shader.uniforms.uHasNightMap.value = 1.0;
        }
        if (earthHeightImage) {
          rebuildEarthNormalFromHeight();
        }
      }

      surfaceMat.needsUpdate = true;
      node.externalTexture = loadedTex;
    });
  }

  if (body.visual.heightTextureUrl) {
    TEXTURE_LOADER.load(body.visual.heightTextureUrl, (loadedHeightTex) => {
      if (loadedHeightTex.image) {
        const img = loadedHeightTex.image;
        const kind = body.visual.kind;
        if (kind === 'earth') {
          earthHeightImage = img as HeightImageSource;
          enqueueNormalMapBuild(() => {
            rebuildEarthNormalFromHeight();
            loadedHeightTex.dispose();
          });
          return;
        }
        const strength = kind === 'mercury' ? 1.4 : 3.1;
        const scale = kind === 'mercury' ? 0.55 : 1.2;
        enqueueNormalMapBuild(() => {
          const normalTex = buildNormalMapFromHeightImage(img, maxAnisotropy, strength);
          surfaceMat.bumpMap = null;
          surfaceMat.normalMap = normalTex;
          surfaceMat.normalScale.set(scale, scale);
          surfaceMat.needsUpdate = true;
          node.externalHeightNormalTexture = normalTex;
          loadedHeightTex.dispose();
        });
        return;
      }
      loadedHeightTex.dispose();
    });
  }

  if (body.visual.nightTextureUrl) {
    TEXTURE_LOADER.load(body.visual.nightTextureUrl, (loadedNightTex) => {
      loadedNightTex.colorSpace = THREE.SRGBColorSpace;
      loadedNightTex.wrapS = THREE.RepeatWrapping;
      loadedNightTex.wrapT = THREE.ClampToEdgeWrapping;
      loadedNightTex.anisotropy = maxAnisotropy;
      loadedNightTex.generateMipmaps = true;
      loadedNightTex.needsUpdate = true;

      surfaceMat.userData.nightLightsMap = loadedNightTex;
      if (surfaceMat.userData.shader) {
        surfaceMat.userData.shader.uniforms.uNightMap.value = loadedNightTex;
        surfaceMat.userData.shader.uniforms.uHasNightMap.value = 1.0;
      }
      node.externalNightTexture = loadedNightTex;
    });
  }

  if (body.visual.cloudTextureUrl && cloudMat && cloudMesh) {
    const targetCloudMat = cloudMat;
    const targetCloudMesh = cloudMesh;
    TEXTURE_LOADER.load(body.visual.cloudTextureUrl, (loadedCloudTex) => {
      loadedCloudTex.wrapS = THREE.RepeatWrapping;
      loadedCloudTex.wrapT = THREE.ClampToEdgeWrapping;
      loadedCloudTex.anisotropy = maxAnisotropy;
      loadedCloudTex.generateMipmaps = true;
      loadedCloudTex.needsUpdate = true;

      targetCloudMat.alphaMap = loadedCloudTex;
      targetCloudMat.needsUpdate = true;
      targetCloudMesh.visible = true;
      node.externalCloudTexture = loadedCloudTex;
    });
  }

  return node;
}

/**
 * Updates analytical shadow uniforms for ringed planets (Saturn, Uranus).
 */
export function updateRingShadowUniforms(
  node: PlanetNode,
  planetRadius: number,
): void {
  if (!node.ringMat && !node.surfaceMat?.userData.ringShadowShader) return;

  node.orbitPivot.getWorldPosition(_ringCenter);

  if (node.ringMat?.userData.shadowShader) {
    const sh = node.ringMat.userData.shadowShader;
    sh.uniforms.uPlanetCenter.value.copy(_ringCenter);
    sh.uniforms.uPlanetRadius.value = planetRadius;
  }

  if (node.surfaceMat?.userData.ringShadowShader && node.data.visual.rings) {
    const sh = node.surfaceMat.userData.ringShadowShader;
    node.tiltGroup.getWorldQuaternion(_ringQuat);
    _ringNormal.set(0, 1, 0).applyQuaternion(_ringQuat).normalize();
    sh.uniforms.uRingCenter.value.copy(_ringCenter);
    sh.uniforms.uRingNormal.value.copy(_ringNormal);
    sh.uniforms.uRingInner.value = planetRadius * node.data.visual.rings.innerFactor;
    sh.uniforms.uRingOuter.value = planetRadius * node.data.visual.rings.outerFactor;
  }
}

/**
 * Synthesizes deferred base-tier procedural PBR maps asynchronously after first paint.
 */
export function bakeBaseProceduralTextures(
  node: PlanetNode,
  maxAnisotropy: number,
): void {
  if (node.hasExternalTexture || node.textures || !node.surfaceMat) {
    return;
  }
  const texSet = buildPlanetTextures(node.data.visual, maxAnisotropy, false);
  node.textures = texSet;
  node.surfaceMat.color.setHex(0xffffff);
  node.surfaceMat.map = texSet.albedoMap;
  node.surfaceMat.normalMap = texSet.normalMap;
  if (texSet.roughnessMap) {
    node.surfaceMat.roughnessMap = texSet.roughnessMap;
    node.surfaceMat.roughness = 1.0;
  }
  node.surfaceMat.needsUpdate = true;
}

/**
 * Defers high-res procedural texture synthesis for moons/Pluto so camera fly-to stays 60fps.
 */
export function upgradePlanetTexturesToHighRes(
  node: PlanetNode,
  maxAnisotropy: number,
): void {
  if (node.hasExternalTexture || node.isUpgradingHighRes || !node.surfaceMat) {
    return;
  }
  if (!node.textures) {
    bakeBaseProceduralTextures(node, maxAnisotropy);
  }
  if (!node.textures || node.textures.resolutionTier === 'high') {
    return;
  }
  node.isUpgradingHighRes = true;

  const runUpgrade = () => {
    if (!node.surfaceMat || !node.textures) return;
    const old = node.textures;
    const high = buildPlanetTextures(node.data.visual, maxAnisotropy, true);

    node.surfaceMat.map = high.albedoMap;
    node.surfaceMat.normalMap = high.normalMap;
    if (high.roughnessMap) {
      node.surfaceMat.roughnessMap = high.roughnessMap;
    }
    node.surfaceMat.needsUpdate = true;

    if (node.cloudMat && high.cloudMap) {
      node.cloudMat.map = high.cloudMap;
      node.cloudMat.needsUpdate = true;
    }

    if (high.nightLightsMap && node.surfaceMat.userData.shader) {
      node.surfaceMat.userData.shader.uniforms.uNightMap.value = high.nightLightsMap;
    }

    node.textures = high;
    node.isUpgradingHighRes = false;

    old.albedoMap.dispose();
    old.normalMap.dispose();
    old.roughnessMap?.dispose();
    old.cloudMap?.dispose();
    old.nightLightsMap?.dispose();
    old.ringMap?.dispose();
  };

  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(
      runUpgrade,
    );
  } else {
    setTimeout(runUpgrade, 16);
  }
}

export function setPlanetNodeGeometryDetail(
  node: PlanetNode,
  tier: 'high' | 'med' | 'low',
): void {
  const isMoon = node.data.category === 'moon';
  const surfaceGeo =
    tier === 'high'
      ? isMoon
        ? SHARED_SPHERE_MED
        : SHARED_SPHERE_HIGH
      : tier === 'med'
        ? SHARED_SPHERE_MED
        : SHARED_SPHERE_LOW;
  const secondaryGeo = tier === 'low' ? SHARED_SPHERE_LOW : SHARED_SPHERE_MED;

  if (node.surfaceMesh.geometry !== surfaceGeo) {
    node.surfaceMesh.geometry = surfaceGeo;
  }
  if (node.cloudMesh && node.cloudMesh.geometry !== surfaceGeo) {
    node.cloudMesh.geometry = surfaceGeo;
  }
  if (node.atmosphereMesh && node.atmosphereMesh.geometry !== secondaryGeo) {
    node.atmosphereMesh.geometry = secondaryGeo;
  }
  if (node.atmosphereVeilMesh && node.atmosphereVeilMesh.geometry !== secondaryGeo) {
    node.atmosphereVeilMesh.geometry = secondaryGeo;
  }
  if (node.sunCoronaMesh && node.sunCoronaMesh.geometry !== secondaryGeo) {
    node.sunCoronaMesh.geometry = secondaryGeo;
  }
}

export function computeAdaptiveOrbitSegments(
  semiMajor: number,
  bodyRadius: number,
  minSegments = 512,
  maxSegments = 16384,
): number {
  if (semiMajor <= 0 || bodyRadius <= 0) return minSegments;
  // Keep chord sagitta <= 0.04 * bodyRadius: a * (dTheta^2 / 8) <= 0.04 * r => N >= 2*pi / sqrt(0.32 * r / a)
  const rOverA = Math.max(bodyRadius / semiMajor, 1e-8);
  const needed = Math.ceil((Math.PI * 2) / Math.sqrt(0.32 * rOverA));
  return Math.max(minSegments, Math.min(maxSegments, needed));
}

export function createOrbitEllipseLine(
  semiMajor: number,
  eccentricity: number,
  inclinationDeg: number,
  colorHex: string,
  segments = 512,
): THREE.LineLoop {
  const coords: number[] = [];
  const incRad = THREE.MathUtils.degToRad(inclinationDeg);
  const cosInc = Math.cos(incRad);
  const sinInc = Math.sin(incRad);
  const b = semiMajor * Math.sqrt(Math.max(0.01, 1 - eccentricity * eccentricity));
  const c = semiMajor * eccentricity;

  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const x = semiMajor * Math.cos(theta) - c;
    const zFlat = b * Math.sin(theta);
    const y = zFlat * sinInc;
    const z = zFlat * cosInc;
    coords.push(x, y, z);
  }

  const geo = createRteLineGeometry(coords);
  const mat = createPrecisionLineMaterial(colorHex, 0.34);
  const line = new THREE.LineLoop(geo, mat);
  attachRteLineBeforeRender(line);
  return line;
}
