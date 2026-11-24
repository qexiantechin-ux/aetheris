import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BODY_MAP, SOLAR_SYSTEM_BODIES } from '../data/solarSystem';
import {
  CONSTELLATIONS,
  CORE_NEARBY_STAR_IDS,
  equatorialToCartesian,
  getStarComponentSolarRadius,
  getStarSolarRadius,
  kelvinToBlackbodySrgb,
  NEARBY_STAR_MAP,
  NEARBY_STARS,
} from '../data/starCatalog';
import {
  CameraRegime,
  CelestialBodyData,
  LayerVisibility,
  MarkerProjection,
  NearbyStarData,
  PlanetariumSettings,
  ScaleMode,
  StarComponentData,
} from '../types/astronomy';
import {
  bakeBaseProceduralTextures,
  computeAdaptiveOrbitSegments,
  createOrbitEllipseLine,
  createPlanetNode,
  PlanetNode,
  setPlanetNodeGeometryDetail,
  updateRingShadowUniforms,
  upgradePlanetTexturesToHighRes,
} from './planetBuilder';
import {
  attachRteLineBeforeRender,
  bakeMilkyWaySkyMaterial,
  createBodyFlareMaterial,
  createFocusedStarFlareMaterial,
  createLensFlareMaterial,
  createMilkyWaySkyMaterial,
  createNearbyStarPointMaterial,
  createPrecisionLineMaterial,
  createRteLineGeometry,
  createStellarCoronaMaterial,
  createStellarSurfaceMaterial,
  encodeRteFloat64Positions,
} from './shaders';

const AU_PER_LIGHT_YEAR = 63241.07708426628;
const TRUE_AU_TO_UNITS = 320;
const BALANCED_AU_TO_UNITS = 32.5;
const TRUE_LY_TO_UNITS = TRUE_AU_TO_UNITS * AU_PER_LIGHT_YEAR; // ~20,237,144.67 scene units per light-year
const BALANCED_LY_TO_UNITS = BALANCED_AU_TO_UNITS * AU_PER_LIGHT_YEAR;

// Pre-allocated scratch vectors (zero GC in render loop)
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _prevTrackedWorld = new THREE.Vector3();
const _currTrackedWorld = new THREE.Vector3();
const _deltaTracked = new THREE.Vector3();
const _flyGoalTarget = new THREE.Vector3();
const _flyGoalCamera = new THREE.Vector3();
const _camForward = new THREE.Vector3();
const _sunNdc = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _toBody = new THREE.Vector3();
const _flarePos = new THREE.Vector3();
const _flareScale = new THREE.Vector3();
const _flareDummyMat = new THREE.Matrix4();

function detectSoftwareWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

function solveEccentricAnomaly(meanAnomaly: number, ecc: number): number {
  if (ecc < 0.0001) return meanAnomaly;
  const twoPi = Math.PI * 2;
  const m = ((((meanAnomaly % twoPi) + twoPi * 1.5) % twoPi) - Math.PI);
  let e = m + ecc * Math.sin(m);
  for (let i = 0; i < 4; i++) {
    const f = e - ecc * Math.sin(e) - m;
    const fp = 1 - ecc * Math.cos(e);
    e -= f / Math.max(fp, 1e-4);
  }
  return e;
}

const MAX_STAR_COMPONENTS = 10;

export interface EngineCallbacks {
  onSelectTarget: (
    id: string | null,
    kind: 'celestial' | 'nearby-star' | null,
    componentId?: string | null,
  ) => void;
  onHoverTarget: (id: string | null, kind: 'celestial' | 'nearby-star' | null) => void;
  onRegimeChange: (regime: CameraRegime, distanceUnits: number) => void;
  onSimTimeTick: (simDaysFromJ2000: number) => void;
  onMarkersFrame: (markers: MarkerProjection[]) => void;
  onWebGLContextLost: (lost: boolean) => void;
}

interface NearbyStarProxy {
  index: number;
  id: string;
  star: NearbyStarData;
  solarRadii: number;
  worldRadius: number;
  overviewSpanUnits: number;
  maxOrbitUnits: number;
  position: THREE.Vector3;
  hitMesh: THREE.Mesh;
}

interface StarComponentSlot {
  slotIndex: number;
  pivot: THREE.Group;
  surfaceMesh: THREE.Mesh;
  surfaceMat: THREE.ShaderMaterial;
  coronaMesh: THREE.Mesh;
  coronaMat: THREE.ShaderMaterial;
  flareMesh: THREE.Mesh;
  flareMat: THREE.ShaderMaterial;
  hitMesh: THREE.Mesh;
  orbitLine: THREE.LineLoop | null;
  orbitParent: THREE.Object3D | null;
  comp: StarComponentData | null;
  solarRadii: number;
  worldRadius: number;
  semiMajorUnits: number;
  bUnits: number;
  ecc: number;
  cosInc: number;
  sinInc: number;
  cosArg: number;
  sinArg: number;
  meanMotion: number;
}

interface CachedOrbitParams {
  semiMajor: number;
  b: number;
  c: number;
  cosInc: number;
  sinInc: number;
  meanMotion: number;
  spinFactor: number; // 1 / spinDays
}

interface SolarBodyEntry {
  body: CelestialBodyData;
  node: PlanetNode;
  parentNode: PlanetNode | null;
  cached: CachedOrbitParams;
}

export class PlanetariumEngine {
  private container: HTMLElement;
  private callbacks: EngineCallbacks;
  private isSoftwareGl: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private maxAnisotropy: number;

  private planetNodes = new Map<string, PlanetNode>();
  private ringedNodes: PlanetNode[] = [];
  private orbitCache = new Map<string, CachedOrbitParams>();
  private solarEntries: SolarBodyEntry[] = [];
  private pendingBakeNodes: PlanetNode[] = [];
  private bakeTimerId: number | null = null;
  private clickableMeshes: THREE.Object3D[] = [];
  private asteroidBeltMesh: THREE.InstancedMesh | null = null;
  private nearbyStarProxies: NearbyStarProxy[] = [];
  private nearbyStarPoints: THREE.Points | null = null;
  private nearbyStarMat: THREE.ShaderMaterial | null = null;
  private focusedStarGroup: THREE.Group | null = null;
  private starComponentSlots: StarComponentSlot[] = [];
  private activeFocusedStarId: string | null = null;
  private skyDome: THREE.Mesh | null = null;
  private skyCubeTarget: THREE.WebGLCubeRenderTarget | null = null;
  private constellationLines: THREE.LineSegments | null = null;
  private constellationMat: THREE.ShaderMaterial | null = null;
  private constellationSegmentIndices: number[] = [];
  private heliosphereRing: THREE.LineLoop | null = null;
  private heliosphereMat: THREE.ShaderMaterial | null = null;
  private lensFlareMesh: THREE.Mesh | null = null;
  private lensFlareMat: THREE.ShaderMaterial | null = null;
  private bodyFlareMesh: THREE.InstancedMesh | null = null;
  private bodyFlareMat: THREE.ShaderMaterial | null = null;
  private bodyFlareIntensityAttr: THREE.InstancedBufferAttribute | null = null;
  private bodyFlareStreakAttr: THREE.InstancedBufferAttribute | null = null;

  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private pointerDownPos = { x: 0, y: 0 };
  private lastHoverRaycast = 0;

  private scaleMode: ScaleMode = 'true';
  private layers: LayerVisibility = {
    orbits: true,
    dwarfOrbits: false,
    labels: true,
    constellations: false,
    asteroids: true,
  };
  private settings: PlanetariumSettings = {
    quality: 0.75,
    lensFlareSize: 1,
    lensFlareStrength: 1,
    showSkybox: true,
  };
  private currentQualityTier: 'high' | 'med' | 'low' = 'high';

  private selectedId: string | null = null;
  private selectedKind: 'celestial' | 'nearby-star' | null = null;
  private selectedComponentId: string | null = null;
  private hoveredId: string | null = null;

  private simDays: number;
  private lastPositionedSimDays = Number.NaN;
  private timeSpeedDaysPerSec = 1 / 86400; // Default: 1× real time

  private isFlying = false;
  private hasTrackedPrev = false;
  private currentRegime: CameraRegime = 'solar';
  private lastHudNotifyTime = 0;
  private lastFadeDist = -1;
  private markersCleared = false;

  private markerBuffer: MarkerProjection[] = [];
  private hadActiveBodyFlares = false;
  private scratchSolarXs: number[] = [];
  private scratchSolarYs: number[] = [];
  private scratchStarXs: number[] = [];
  private scratchStarYs: number[] = [];
  private scratchCompXs: number[] = [];
  private scratchCompYs: number[] = [];
  private solarPassBuckets: [number[], number[], number[], number[]] = [[], [], [], []];

  private frameId = 0;
  private disposed = false;
  private clock = new THREE.Clock();

  constructor(container: HTMLElement, callbacks: EngineCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.isSoftwareGl = detectSoftwareWebGL();

    const j2000Ms = Date.UTC(2000, 0, 1, 12, 0, 0);
    this.simDays = (Date.now() - j2000Ms) / 86400000;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(this.getEffectivePixelRatio());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = false;
    this.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();

    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#04060A');
    this.scene.environment = null;

    this.camera = new THREE.PerspectiveCamera(48, width / height, 0.05, 2.0e12);
    this.camera.position.set(0, 1800, 4000);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.085;
    this.controls.rotateSpeed = 0.78;
    this.controls.zoomSpeed = 1.25;
    this.controls.panSpeed = 0.88;
    this.controls.minDistance = 0.00001;
    this.controls.maxDistance = 6.0e10;
    this.controls.target.set(0, 0, 0);

    this.controls.addEventListener('start', () => {
      this.isFlying = false;
    });

    this.raycaster.layers.set(1);

    this.setupLighting();
    this.setupSkyAndStarfield();
    this.setupSolarSystem();
    this.setupAsteroidBelt();
    this.setupNearbyStars();
    this.setupFocusedStarRig();
    this.setupConstellations();
    this.setupBodyFlares();
    this.setupLensFlare();
    this.setSettings(this.settings);

    this.updateOrbitalPositions(0);
    this.bindEvents();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.startLoop();
    this.schedulePendingTextureBakes();
  }

  private schedulePendingTextureBakes(): void {
    if (this.disposed || this.pendingBakeNodes.length === 0) return;
    const processBatch = () => {
      this.bakeTimerId = null;
      if (this.disposed) return;
      const start = performance.now();
      let processed = 0;
      while (this.pendingBakeNodes.length > 0 && processed < 3 && performance.now() - start < 10) {
        const node = this.pendingBakeNodes.shift()!;
        bakeBaseProceduralTextures(node, this.maxAnisotropy);
        processed++;
      }
      if (this.pendingBakeNodes.length > 0) {
        this.schedulePendingTextureBakes();
      }
    };
    this.bakeTimerId = window.setTimeout(processBatch, 24);
  }

  private setupLighting(): void {
    // Pure solar point-source radiance only — true 5778 K white, zero ambient fill
    const sunLight = new THREE.PointLight(0xfff6ed, 4.2, 0, 0);
    sunLight.position.set(0, 0, 0);
    this.scene.add(sunLight);
  }

  private setupSkyAndStarfield(): void {
    const skyGeo = new THREE.SphereGeometry(6.0e11, 40, 28);
    const skyMat = createMilkyWaySkyMaterial();
    const baked = bakeMilkyWaySkyMaterial(this.renderer, skyMat);
    if (baked) {
      skyMat.dispose();
      this.skyCubeTarget = baked.cubeTarget;
      this.skyDome = new THREE.Mesh(skyGeo, baked.material);
    } else {
      this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    }
    this.skyDome.frustumCulled = false;
    this.skyDome.visible = this.settings.showSkybox;
    this.scene.add(this.skyDome);
  }

  private setupSolarSystem(): void {
    for (const body of SOLAR_SYSTEM_BODIES) {
      const canDefer =
        !body.visual.textureUrl &&
        (body.category === 'moon' || Boolean(body.isDwarfCandidate)) &&
        !body.visual.hasClouds &&
        !body.visual.rings &&
        !body.visual.hasNightLights;
      const node = createPlanetNode(body, this.maxAnisotropy, this.clickableMeshes, canDefer);
      this.planetNodes.set(body.id, node);
      if (canDefer) {
        this.pendingBakeNodes.push(node);
      }
      if (body.visual.rings) {
        this.ringedNodes.push(node);
      }
    }

    for (const body of SOLAR_SYSTEM_BODIES) {
      const node = this.planetNodes.get(body.id)!;
      if (body.parentId && this.planetNodes.has(body.parentId)) {
        const parent = this.planetNodes.get(body.parentId)!;
        const orbitParent = body.orbitInParentEquator ? parent.equatorialGroup : parent.orbitPivot;
        orbitParent.add(node.orbitPivot);
      } else {
        this.scene.add(node.orbitPivot);
      }
    }

    const helioCoords: number[] = [];
    for (let i = 0; i < 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      helioCoords.push(Math.cos(a) * 260, 0, Math.sin(a) * 260);
    }
    const helioGeo = createRteLineGeometry(helioCoords);
    this.heliosphereMat = createPrecisionLineMaterial('#06B6D4', 0);
    this.heliosphereRing = new THREE.LineLoop(helioGeo, this.heliosphereMat);
    attachRteLineBeforeRender(this.heliosphereRing);
    this.scene.add(this.heliosphereRing);

    this.applyBodyScales();
  }

  private setupAsteroidBelt(): void {
    const count = 1200;
    const rockGeo = new THREE.DodecahedronGeometry(0.18, 0);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.94,
      metalness: 0.06,
      envMapIntensity: 0,
    });

    const mesh = new THREE.InstancedMesh(rockGeo, rockMat, count);
    this.asteroidBeltMesh = mesh;
    this.populateAsteroidInstances();
    this.scene.add(mesh);
  }

  private populateAsteroidInstances(): void {
    if (!this.asteroidBeltMesh) return;
    const count = this.asteroidBeltMesh.count;
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();

    const innerR = this.scaleMode === 'balanced' ? 51.5 : 2.1 * TRUE_AU_TO_UNITS;
    const outerR = this.scaleMode === 'balanced' ? 61.5 : 3.35 * TRUE_AU_TO_UNITS;
    const rockScaleBase = this.scaleMode === 'balanced' ? 1.0 : 0.08;

    let s = 918273;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };

    for (let i = 0; i < count; i++) {
      const r = innerR + rand() * (outerR - innerR);
      const angle = rand() * Math.PI * 2;
      const ySpread = (rand() - 0.5) * (this.scaleMode === 'balanced' ? 3.2 : 12.0);
      dummy.position.set(Math.cos(angle) * r, ySpread, Math.sin(angle) * r);
      dummy.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      const baseScale = (0.38 + Math.pow(rand(), 2) * 1.4) * rockScaleBase;
      dummy.scale.set(
        baseScale * (0.7 + rand() * 0.6),
        baseScale * (0.65 + rand() * 0.6),
        baseScale * (0.7 + rand() * 0.6),
      );
      dummy.updateMatrix();
      this.asteroidBeltMesh.setMatrixAt(i, dummy.matrix);

      const shade = 0.36 + rand() * 0.34;
      col.setRGB(shade * 1.04, shade * 0.96, shade * 0.88);
      this.asteroidBeltMesh.setColorAt(i, col);
    }

    this.asteroidBeltMesh.instanceMatrix.needsUpdate = true;
    if (this.asteroidBeltMesh.instanceColor) {
      this.asteroidBeltMesh.instanceColor.needsUpdate = true;
    }
    this.asteroidBeltMesh.computeBoundingSphere();
  }

  private getAuToUnits(): number {
    return this.scaleMode === 'true' ? TRUE_AU_TO_UNITS : BALANCED_AU_TO_UNITS;
  }

  private getLyToUnits(): number {
    return this.scaleMode === 'true' ? TRUE_LY_TO_UNITS : BALANCED_LY_TO_UNITS;
  }

  private getSunBaseRadius(): number {
    return this.scaleMode === 'true' ? 1.48952 : 7.2;
  }

  private getStarUnitsPerSolarRadius(star: NearbyStarData): number {
    if (star.components && star.components.length > 0) {
      return this.getAuToUnits() * 0.00465047;
    }
    return this.getSunBaseRadius();
  }

  private computeMaxOrbitAu(star: NearbyStarData): number {
    if (!star.components || star.components.length === 0) return 0;
    const byId = new Map<string, StarComponentData>();
    for (const c of star.components) byId.set(c.id, c);
    let maxAu = 0;
    for (const c of star.components) {
      let total = c.semiMajorAu * (1 + c.eccentricity);
      let pid = c.parentId;
      while (pid && byId.has(pid)) {
        const p = byId.get(pid)!;
        total += p.semiMajorAu * (1 + p.eccentricity);
        pid = p.parentId;
      }
      if (total > maxAu) maxAu = total;
    }
    return maxAu;
  }

  private setupNearbyStars(): void {
    const count = NEARBY_STARS.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const absMags = new Float32Array(count);
    const starIndices = new Float32Array(count);

    const hitGeo = new THREE.SphereGeometry(1, 10, 8);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const lyUnits = this.getLyToUnits();
    const auUnits = this.getAuToUnits();

    for (let i = 0; i < count; i++) {
      const star = NEARBY_STARS[i];
      const [x, y, z] = equatorialToCartesian(
        star.raHours,
        star.decDeg,
        star.distanceLy * lyUnits,
      );
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      const [r, g, b] = kelvinToBlackbodySrgb(star.temperatureK);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;

      absMags[i] = star.absoluteMag;
      starIndices[i] = i;

      const solarRadii = getStarSolarRadius(star);
      const worldRadius = solarRadii * this.getStarUnitsPerSolarRadius(star);
      const overviewSpanUnits = (star.overviewSpanAu ?? 0) * auUnits;
      const maxOrbitUnits = this.computeMaxOrbitAu(star) * auUnits;

      const proxy = new THREE.Mesh(hitGeo, hitMat);
      proxy.position.set(x, y, z);
      proxy.scale.setScalar(Math.max(worldRadius * 1.35, 1400));
      proxy.layers.set(1);
      proxy.userData = { targetId: star.id, kind: 'nearby-star' };
      this.scene.add(proxy);
      this.clickableMeshes.push(proxy);
      this.nearbyStarProxies.push({
        index: i,
        id: star.id,
        star,
        solarRadii,
        worldRadius,
        overviewSpanUnits,
        maxOrbitUnits,
        position: new THREE.Vector3(x, y, z),
        hitMesh: proxy,
      });
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aAbsMag', new THREE.BufferAttribute(absMags, 1));
    geo.setAttribute('aStarIndex', new THREE.BufferAttribute(starIndices, 1));

    this.nearbyStarMat = createNearbyStarPointMaterial();
    this.nearbyStarMat.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    this.nearbyStarMat.uniforms.uParsecUnits.value = lyUnits * 3.261563777;
    this.nearbyStarPoints = new THREE.Points(geo, this.nearbyStarMat);
    this.nearbyStarPoints.frustumCulled = false;
    this.scene.add(this.nearbyStarPoints);
  }

  private applyNearbyStarScales(): void {
    if (!this.nearbyStarPoints || this.nearbyStarProxies.length === 0) return;
    const posAttr = this.nearbyStarPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    const lyUnits = this.getLyToUnits();
    const auUnits = this.getAuToUnits();

    if (this.nearbyStarMat) {
      this.nearbyStarMat.uniforms.uParsecUnits.value = lyUnits * 3.261563777;
    }

    for (let i = 0; i < this.nearbyStarProxies.length; i++) {
      const sp = this.nearbyStarProxies[i];
      const [x, y, z] = equatorialToCartesian(
        sp.star.raHours,
        sp.star.decDeg,
        sp.star.distanceLy * lyUnits,
      );
      sp.position.set(x, y, z);
      sp.worldRadius = sp.solarRadii * this.getStarUnitsPerSolarRadius(sp.star);
      sp.overviewSpanUnits = (sp.star.overviewSpanAu ?? 0) * auUnits;
      sp.maxOrbitUnits = this.computeMaxOrbitAu(sp.star) * auUnits;
      sp.hitMesh.position.set(x, y, z);
      arr[i * 3] = x;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = z;
    }
    posAttr.needsUpdate = true;
    this.nearbyStarPoints.geometry.computeBoundingSphere();
    this.updateConstellationPositions();

    if (this.activeFocusedStarId) {
      const activeProxy = this.nearbyStarProxies.find((s) => s.id === this.activeFocusedStarId);
      if (activeProxy) {
        this.focusedStarGroup?.position.copy(activeProxy.position);
        this.rebuildFocusedStarSystem(activeProxy);
      }
    }
  }

  private setupFocusedStarRig(): void {
    this.focusedStarGroup = new THREE.Group();
    this.focusedStarGroup.visible = false;

    const surfaceGeo = new THREE.SphereGeometry(1, 80, 56);
    const coronaGeo = new THREE.SphereGeometry(1, 48, 36);
    const flareGeo = new THREE.PlaneGeometry(1, 1);
    const hitGeo = new THREE.SphereGeometry(1, 10, 8);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });

    for (let i = 0; i < MAX_STAR_COMPONENTS; i++) {
      const pivot = new THREE.Group();
      pivot.visible = false;

      const surfaceMat = createStellarSurfaceMaterial();
      const surfaceMesh = new THREE.Mesh(surfaceGeo, surfaceMat);
      surfaceMesh.frustumCulled = false;
      pivot.add(surfaceMesh);

      const coronaMat = createStellarCoronaMaterial();
      const coronaMesh = new THREE.Mesh(coronaGeo, coronaMat);
      coronaMesh.frustumCulled = false;
      pivot.add(coronaMesh);

      const flareMat = createFocusedStarFlareMaterial();
      const flareMesh = new THREE.Mesh(flareGeo, flareMat);
      flareMesh.frustumCulled = false;
      flareMesh.renderOrder = -1;
      pivot.add(flareMesh);

      const hitMesh = new THREE.Mesh(hitGeo, hitMat);
      hitMesh.layers.set(0);
      hitMesh.frustumCulled = false;
      pivot.add(hitMesh);
      this.clickableMeshes.push(hitMesh);

      this.focusedStarGroup.add(pivot);
      this.starComponentSlots.push({
        slotIndex: i,
        pivot,
        surfaceMesh,
        surfaceMat,
        coronaMesh,
        coronaMat,
        flareMesh,
        flareMat,
        hitMesh,
        orbitLine: null,
        orbitParent: null,
        comp: null,
        solarRadii: 1,
        worldRadius: 1,
        semiMajorUnits: 0,
        bUnits: 0,
        ecc: 0,
        cosInc: 1,
        sinInc: 0,
        cosArg: 1,
        sinArg: 0,
        meanMotion: 0,
      });
    }

    this.scene.add(this.focusedStarGroup);
  }

  private createComponentOrbitLine(
    semiMajor: number,
    ecc: number,
    cosInc: number,
    sinInc: number,
    cosArg: number,
    sinArg: number,
    colorHex: string,
    segments = 160,
  ): THREE.LineLoop {
    const b = semiMajor * Math.sqrt(Math.max(1e-6, 1 - ecc * ecc));
    const coords: number[] = [];
    for (let i = 0; i < segments; i++) {
      const ea = (i / segments) * Math.PI * 2;
      const xOrb = semiMajor * (Math.cos(ea) - ecc);
      const zOrb = b * Math.sin(ea);
      const xRot = xOrb * cosArg - zOrb * sinArg;
      const zRot = xOrb * sinArg + zOrb * cosArg;
      coords.push(xRot, zRot * sinInc, zRot * cosInc);
    }
    const geo = createRteLineGeometry(coords);
    const mat = createPrecisionLineMaterial(colorHex, 0.42);
    const line = new THREE.LineLoop(geo, mat);
    attachRteLineBeforeRender(line);
    return line;
  }

  private rebuildFocusedStarSystem(proxy: NearbyStarProxy): void {
    if (!this.focusedStarGroup) return;

    const star = proxy.star;
    const auUnits = this.getAuToUnits();
    const radiusScale = this.getStarUnitsPerSolarRadius(star);

    const components: StarComponentData[] =
      star.components && star.components.length > 0
        ? star.components.slice(0, MAX_STAR_COMPONENTS)
        : [
            {
              id: `${star.id}-primary`,
              name: star.name,
              spectralClass: star.spectralClass,
              temperatureK: star.temperatureK,
              luminositySolar: Math.max(1e-4, Math.pow(10, (4.83 - star.absoluteMag) / 2.5)),
              massSolar: 1,
              radiusSolar: proxy.solarRadii,
              parentId: null,
              semiMajorAu: 0,
              eccentricity: 0,
              inclinationDeg: 0,
              argPeriapsisDeg: 0,
              orbitalPeriodDays: 1,
              initialAngleRad: 0,
              orbitColor: star.color,
            },
          ];

    // Clear all previous orbits & detach from sub-pivots
    for (let i = 0; i < MAX_STAR_COMPONENTS; i++) {
      const slot = this.starComponentSlots[i];
      if (slot.orbitLine && slot.orbitParent) {
        slot.orbitParent.remove(slot.orbitLine);
        slot.orbitLine.geometry.dispose();
        (slot.orbitLine.material as THREE.Material).dispose();
      }
      slot.orbitLine = null;
      slot.orbitParent = null;
      slot.comp = null;
      slot.pivot.visible = false;
      slot.hitMesh.layers.set(0);
      this.focusedStarGroup.add(slot.pivot);
    }

    const compSlotById = new Map<string, StarComponentSlot>();
    for (let i = 0; i < components.length; i++) {
      const comp = components[i];
      const slot = this.starComponentSlots[i];
      slot.comp = comp;
      compSlotById.set(comp.id, slot);
    }

    for (let i = 0; i < components.length; i++) {
      const comp = components[i];
      const slot = this.starComponentSlots[i];
      const parentSlot = comp.parentId ? compSlotById.get(comp.parentId) ?? null : null;
      const parentObj: THREE.Object3D = parentSlot ? parentSlot.pivot : this.focusedStarGroup;
      parentObj.add(slot.pivot);

      const solarRadii = getStarComponentSolarRadius(comp);
      const worldRadius = solarRadii * radiusScale;
      slot.solarRadii = solarRadii;
      slot.worldRadius = worldRadius;

      const semiMajorUnits = comp.semiMajorAu * auUnits;
      const ecc = THREE.MathUtils.clamp(comp.eccentricity, 0, 0.95);
      const incRad = THREE.MathUtils.degToRad(comp.inclinationDeg);
      const argRad = THREE.MathUtils.degToRad(comp.argPeriapsisDeg);
      slot.semiMajorUnits = semiMajorUnits;
      slot.bUnits = semiMajorUnits * Math.sqrt(Math.max(1e-6, 1 - ecc * ecc));
      slot.ecc = ecc;
      slot.cosInc = Math.cos(incRad);
      slot.sinInc = Math.sin(incRad);
      slot.cosArg = Math.cos(argRad);
      slot.sinArg = Math.sin(argRad);
      slot.meanMotion = comp.orbitalPeriodDays > 0 ? (Math.PI * 2) / comp.orbitalPeriodDays : 0;

      slot.pivot.visible = true;
      const isPhysical = !comp.isVirtualBarycenter;
      slot.surfaceMesh.visible = isPhysical;
      slot.coronaMesh.visible = isPhysical;
      slot.flareMesh.visible = false;
      slot.hitMesh.layers.set(isPhysical ? 1 : 0);
      slot.hitMesh.userData = {
        targetId: proxy.id,
        kind: 'nearby-star',
        componentId: comp.id,
      };

      if (isPhysical) {
        slot.surfaceMesh.scale.setScalar(worldRadius);
        slot.coronaMesh.scale.setScalar(worldRadius * 1.44);
        this.applyComponentPalette(slot, comp.temperatureK, solarRadii);
      }

      if (semiMajorUnits > 0.0001) {
        const refRadius = isPhysical ? worldRadius : Math.max(worldRadius, semiMajorUnits * 0.0004);
        const segs = computeAdaptiveOrbitSegments(semiMajorUnits, refRadius, 768, 16384);
        const line = this.createComponentOrbitLine(
          semiMajorUnits,
          ecc,
          slot.cosInc,
          slot.sinInc,
          slot.cosArg,
          slot.sinArg,
          comp.orbitColor,
          segs,
        );
        line.visible = this.layers.orbits;
        slot.orbitLine = line;
        slot.orbitParent = parentObj;
        parentObj.add(line);
      }
    }

    this.evaluateComponentSlotPositions();
  }

  private evaluateComponentSlotPositions(): void {
    for (let i = 0; i < MAX_STAR_COMPONENTS; i++) {
      const slot = this.starComponentSlots[i];
      if (!slot.pivot.visible || !slot.comp) continue;
      if (slot.semiMajorUnits <= 0.0001) {
        slot.pivot.position.set(0, 0, 0);
        continue;
      }
      const meanAnomaly = slot.comp.initialAngleRad + this.simDays * slot.meanMotion;
      const ea = solveEccentricAnomaly(meanAnomaly, slot.ecc);
      const xOrb = slot.semiMajorUnits * (Math.cos(ea) - slot.ecc);
      const zOrb = slot.bUnits * Math.sin(ea);
      const xRot = xOrb * slot.cosArg - zOrb * slot.sinArg;
      const zRot = xOrb * slot.sinArg + zOrb * slot.cosArg;
      slot.pivot.position.set(xRot, zRot * slot.sinInc, zRot * slot.cosInc);
    }
  }

  private ensureFocusedStarSystemFor(proxy: NearbyStarProxy): void {
    if (!this.focusedStarGroup) return;
    this.focusedStarGroup.position.copy(proxy.position);
    if (this.activeFocusedStarId !== proxy.id) {
      this.activeFocusedStarId = proxy.id;
      this.rebuildFocusedStarSystem(proxy);
    } else {
      this.evaluateComponentSlotPositions();
    }
    this.focusedStarGroup.updateMatrixWorld(true);
  }

  private applyComponentPalette(
    slot: StarComponentSlot,
    temperatureK: number,
    solarRadii: number,
  ): void {
    const u = slot.surfaceMat.uniforms;
    const cu = slot.coronaMat.uniforms;
    const t = temperatureK;

    const [hr, hg, hb] = kelvinToBlackbodySrgb(t * 1.09);
    const [mr, mg, mb] = kelvinToBlackbodySrgb(t);
    const [cr, cg, cb] = kelvinToBlackbodySrgb(t * 0.87);
    const [ur, ug, ub] = kelvinToBlackbodySrgb(t * 0.68);
    const [lr, lg, lb] = kelvinToBlackbodySrgb(t * 0.82);

    u.uHotColor.value.setRGB(
      Math.min(1, hr * 1.04),
      Math.min(1, hg * 1.04),
      Math.min(1, hb * 1.04),
    );
    u.uMidColor.value.setRGB(mr, mg, mb);
    u.uCoolColor.value.setRGB(cr * 0.84, cg * 0.84, cb * 0.84);
    u.uUmbraColor.value.setRGB(ur * 0.38, ug * 0.38, ub * 0.38);
    u.uLimbTint.value.setRGB(lr * 0.78, lg * 0.78, lb * 0.78);

    const [cir, cig, cib] = kelvinToBlackbodySrgb(t * 1.04);
    const [cor, cog, cob] = kelvinToBlackbodySrgb(t * 0.93);
    cu.uInnerColor.value.setRGB(
      cir * 0.55 + 0.45,
      cig * 0.55 + 0.45,
      cib * 0.55 + 0.45,
    );
    cu.uOuterColor.value.setRGB(cor * 0.94, cog * 0.94, cob * 0.94);

    if (solarRadii < 0.05) {
      // Degenerate white dwarf: ultra-smooth hot surface, low spot modulation
      u.uGranuleScale.value = 10.5;
      u.uSpotIntensity.value = 0.08;
    } else if (solarRadii > 20) {
      u.uGranuleScale.value = 2.6;
      u.uSpotIntensity.value = 0.56;
    } else if (solarRadii > 4) {
      u.uGranuleScale.value = 4.2;
      u.uSpotIntensity.value = 0.48;
    } else if (t >= 7400) {
      u.uGranuleScale.value = 7.4;
      u.uSpotIntensity.value = 0.20;
    } else if (t < 3800) {
      u.uGranuleScale.value = 7.2;
      u.uSpotIntensity.value = 0.65;
    } else {
      u.uGranuleScale.value = 6.2;
      u.uSpotIntensity.value = 0.46;
    }

    slot.flareMat.uniforms.uColor.value.setRGB(
      mr * 0.68 + 0.32,
      mg * 0.68 + 0.32,
      mb * 0.68 + 0.32,
    );
  }

  private setupConstellations(): void {
    const starIndexById = new Map<string, number>();
    for (let i = 0; i < this.nearbyStarProxies.length; i++) {
      starIndexById.set(this.nearbyStarProxies[i].id, i);
    }

    this.constellationSegmentIndices = [];
    const verts: number[] = [];

    for (const con of CONSTELLATIONS) {
      for (const [idA, idB] of con.starPairs) {
        const idxA = starIndexById.get(idA);
        const idxB = starIndexById.get(idB);
        if (idxA === undefined || idxB === undefined) continue;
        this.constellationSegmentIndices.push(idxA, idxB);
        const pA = this.nearbyStarProxies[idxA].position;
        const pB = this.nearbyStarProxies[idxB].position;
        verts.push(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z);
      }
    }

    const geo = createRteLineGeometry(verts);
    (geo.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    (geo.getAttribute('aPosMid') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    (geo.getAttribute('aPosLow') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    this.constellationMat = createPrecisionLineMaterial('#38BDF8', 0.24);
    this.constellationLines = new THREE.LineSegments(geo, this.constellationMat);
    this.constellationLines.visible = this.layers.constellations;
    attachRteLineBeforeRender(this.constellationLines);
    this.scene.add(this.constellationLines);
  }

  private updateConstellationPositions(): void {
    if (!this.constellationLines || this.constellationSegmentIndices.length === 0) return;
    const pos0Attr = this.constellationLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const pos1Attr = this.constellationLines.geometry.getAttribute('aPosMid') as THREE.BufferAttribute;
    const pos2Attr = this.constellationLines.geometry.getAttribute('aPosLow') as THREE.BufferAttribute;
    const coords = new Float64Array(this.constellationSegmentIndices.length * 3);
    for (let i = 0; i < this.constellationSegmentIndices.length; i++) {
      const p = this.nearbyStarProxies[this.constellationSegmentIndices[i]].position;
      coords[i * 3] = p.x;
      coords[i * 3 + 1] = p.y;
      coords[i * 3 + 2] = p.z;
    }
    encodeRteFloat64Positions(
      coords,
      pos0Attr.array as Float32Array,
      pos1Attr.array as Float32Array,
      pos2Attr.array as Float32Array,
    );
    pos0Attr.needsUpdate = true;
    pos1Attr.needsUpdate = true;
    pos2Attr.needsUpdate = true;
    this.constellationLines.geometry.computeBoundingSphere();
  }

  private setupBodyFlares(): void {
    const count = SOLAR_SYSTEM_BODIES.length;
    const geo = new THREE.PlaneGeometry(1, 1);
    const colors = new Float32Array(count * 3);
    const intensities = new Float32Array(count);
    const streaks = new Float32Array(count);

    const white = new THREE.Color('#FFFFFF');
    const c = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const body = SOLAR_SYSTEM_BODIES[i];
      if (body.id === 'sun') {
        const [sr, sg, sb] = kelvinToBlackbodySrgb(5778);
        colors[i * 3] = sr * 0.7 + 0.3;
        colors[i * 3 + 1] = sg * 0.7 + 0.3;
        colors[i * 3 + 2] = sb * 0.7 + 0.3;
      } else {
        c.set(body.visual.atmosphereColor ?? body.visual.baseColor);
        c.lerp(white, 0.45);
        c.getRGB(c, THREE.SRGBColorSpace);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
    }

    const colorAttr = new THREE.InstancedBufferAttribute(colors, 3);
    this.bodyFlareIntensityAttr = new THREE.InstancedBufferAttribute(intensities, 1);
    this.bodyFlareStreakAttr = new THREE.InstancedBufferAttribute(streaks, 1);
    geo.setAttribute('aFlareColor', colorAttr);
    geo.setAttribute('aFlareIntensity', this.bodyFlareIntensityAttr);
    geo.setAttribute('aStreakWeight', this.bodyFlareStreakAttr);

    this.bodyFlareMat = createBodyFlareMaterial();
    this.bodyFlareMesh = new THREE.InstancedMesh(geo, this.bodyFlareMat, count);
    this.bodyFlareMesh.frustumCulled = false;
    this.bodyFlareMesh.renderOrder = -1;
    this.scene.add(this.bodyFlareMesh);
  }

  private setupLensFlare(): void {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.lensFlareMat = createLensFlareMaterial();
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.lensFlareMat.uniforms.uAspect.value = width / Math.max(height, 1);

    this.lensFlareMesh = new THREE.Mesh(geo, this.lensFlareMat);
    this.lensFlareMesh.frustumCulled = false;
    this.lensFlareMesh.renderOrder = 10;
    this.lensFlareMesh.visible = false;
    this.scene.add(this.lensFlareMesh);
  }

  private getBodyRadius(body: (typeof SOLAR_SYSTEM_BODIES)[number]): number {
    return this.scaleMode === 'balanced' ? body.balancedRadius : body.trueRadius;
  }

  private getOrbitRadius(body: (typeof SOLAR_SYSTEM_BODIES)[number]): number {
    if (this.scaleMode === 'balanced') {
      return body.balancedOrbitRadius;
    }
    return body.trueOrbitRadius;
  }

  private rebuildOrbitCache(): void {
    this.orbitCache.clear();
    this.solarEntries.length = 0;
    for (const body of SOLAR_SYSTEM_BODIES) {
      const semiMajor = this.getOrbitRadius(body);
      const ecc = body.eccentricity;
      const incRad = THREE.MathUtils.degToRad(body.inclinationDeg);
      const spinDays = body.rotationPeriodHours / 24;
      const cached: CachedOrbitParams = {
        semiMajor,
        b: semiMajor * Math.sqrt(Math.max(0.01, 1 - ecc * ecc)),
        c: semiMajor * ecc,
        cosInc: Math.cos(incRad),
        sinInc: Math.sin(incRad),
        meanMotion: (Math.PI * 2) / body.orbitalPeriodDays,
        spinFactor: spinDays !== 0 ? (Math.PI * 2) / spinDays : 0,
      };
      this.orbitCache.set(body.id, cached);
      const node = this.planetNodes.get(body.id);
      if (node) {
        this.solarEntries.push({
          body,
          node,
          parentNode: body.parentId ? this.planetNodes.get(body.parentId) ?? null : null,
          cached,
        });
      }
    }
    this.lastPositionedSimDays = Number.NaN;
  }

  private applyBodyScales(): void {
    this.rebuildOrbitCache();

    for (const body of SOLAR_SYSTEM_BODIES) {
      const node = this.planetNodes.get(body.id);
      if (!node) continue;
      const r = this.getBodyRadius(body);
      node.surfaceMesh.scale.setScalar(r);
      if (node.cloudMesh) node.cloudMesh.scale.setScalar(r * 1.005);
      if (node.atmosphereVeilMesh) {
        node.atmosphereVeilMesh.scale.setScalar(r * (node.atmosphereVeilScale ?? 1.0075));
      }
      if (node.atmosphereMesh) {
        node.atmosphereMesh.scale.setScalar(r * (node.atmosphereScale ?? 1.036));
      }
      if (node.ringMesh) node.ringMesh.scale.setScalar(r);
      if (node.sunCoronaMesh) node.sunCoronaMesh.scale.setScalar(r * 1.38);

      if (body.parentId) {
        const parent = this.planetNodes.get(body.parentId);
        if (parent) {
          const orbitParent = body.orbitInParentEquator ? parent.equatorialGroup : parent.orbitPivot;
          if (node.orbitLine) {
            parent.orbitPivot.remove(node.orbitLine);
            parent.equatorialGroup.remove(node.orbitLine);
            node.orbitLine.geometry.dispose();
            (node.orbitLine.material as THREE.Material).dispose();
          }
          const orbitRadius = this.getOrbitRadius(body);
          const segs = computeAdaptiveOrbitSegments(
            orbitRadius,
            r,
            body.category === 'moon' ? 512 : 768,
            16384,
          );
          const newOrbit = createOrbitEllipseLine(
            orbitRadius,
            body.eccentricity,
            body.inclinationDeg,
            body.orbitColor,
            segs,
          );
          newOrbit.visible =
            this.layers.orbits && (body.category !== 'dwarf' || this.layers.dwarfOrbits);
          node.orbitLine = newOrbit;
          orbitParent.add(newOrbit);
        }
      }
    }

    if (this.heliosphereRing) {
      const helioScale = this.scaleMode === 'balanced' ? 1.0 : (120 * TRUE_AU_TO_UNITS) / 260;
      this.heliosphereRing.scale.setScalar(helioScale);
    }

    this.controls.minDistance = this.scaleMode === 'true' ? 0.00001 : 0.008;
    this.populateAsteroidInstances();
    this.applyNearbyStarScales();
    this.lastFadeDist = -1;
  }

  public setScaleMode(mode: ScaleMode): void {
    if (this.scaleMode === mode) return;
    this.scaleMode = mode;
    this.applyBodyScales();
    this.updateOrbitalPositions(0);

    if (this.selectedId && this.selectedKind) {
      this.flyToTarget(this.selectedId, this.selectedKind, this.selectedComponentId);
    } else {
      this.zoomToSolarOverview();
    }
  }

  public setLayers(layers: LayerVisibility): void {
    this.layers = { ...layers };
    for (const node of this.planetNodes.values()) {
      if (node.orbitLine) {
        node.orbitLine.visible =
          layers.orbits && (node.data.category !== 'dwarf' || layers.dwarfOrbits);
      }
    }
    for (let i = 0; i < this.starComponentSlots.length; i++) {
      const slot = this.starComponentSlots[i];
      if (slot.orbitLine) {
        slot.orbitLine.visible = layers.orbits;
      }
    }
    if (this.asteroidBeltMesh) {
      this.asteroidBeltMesh.visible = layers.asteroids;
    }
    if (this.constellationLines) {
      this.constellationLines.visible = layers.constellations;
    }
    this.lastFadeDist = -1;
  }

  private getEffectivePixelRatio(): number {
    const maxPr = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2);
    const minPr = Math.min(0.5, maxPr);
    const q = THREE.MathUtils.clamp(this.settings.quality, 0.25, 1);
    return THREE.MathUtils.lerp(minPr, maxPr, (q - 0.25) / 0.75);
  }

  public setSettings(settings: PlanetariumSettings): void {
    this.settings = { ...settings };

    if (this.skyDome) {
      this.skyDome.visible = this.settings.showSkybox;
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.setHex(this.settings.showSkybox ? 0x04060a : 0x000000);
    }

    const q = THREE.MathUtils.clamp(this.settings.quality, 0.25, 1);
    const pr = this.getEffectivePixelRatio();
    this.renderer.setPixelRatio(pr);
    if (this.nearbyStarMat) {
      this.nearbyStarMat.uniforms.uPixelRatio.value = pr;
    }

    const tier: 'high' | 'med' | 'low' = q >= 0.7 ? 'high' : q >= 0.45 ? 'med' : 'low';
    if (tier !== this.currentQualityTier) {
      this.currentQualityTier = tier;
      for (const node of this.planetNodes.values()) {
        setPlanetNodeGeometryDetail(node, tier);
      }
    }

    if (this.asteroidBeltMesh) {
      this.asteroidBeltMesh.count = Math.max(120, Math.round(1200 * (0.25 + 0.75 * q)));
    }
  }

  public setTimeSpeed(daysPerSecond: number): void {
    this.timeSpeedDaysPerSec = daysPerSecond;
  }

  public jumpToNow(): void {
    const j2000Ms = Date.UTC(2000, 0, 1, 12, 0, 0);
    this.simDays = (Date.now() - j2000Ms) / 86400000;
    this.updateOrbitalPositions(0);
    if (this.focusedStarGroup?.visible) {
      this.evaluateComponentSlotPositions();
      this.focusedStarGroup.updateMatrixWorld(true);
    }
    this.callbacks.onSimTimeTick(this.simDays);
  }

  public selectAndFlyTo(
    id: string | null,
    kind: 'celestial' | 'nearby-star' | null,
    componentId?: string | null,
  ): void {
    this.selectedId = id;
    this.selectedKind = kind;
    this.selectedComponentId = kind === 'nearby-star' ? (componentId ?? null) : null;
    this.hasTrackedPrev = false;

    if (!id || !kind) {
      this.callbacks.onSelectTarget(null, null, null);
      return;
    }

    this.callbacks.onSelectTarget(id, kind, this.selectedComponentId);
    this.flyToTarget(id, kind, this.selectedComponentId);
  }

  private flyToTarget(
    id: string,
    kind: 'celestial' | 'nearby-star',
    componentId?: string | null,
  ): void {
    if (kind === 'celestial') {
      const node = this.planetNodes.get(id);
      if (!node) return;

      if (node.data.visual.kind !== 'sun') {
        upgradePlanetTexturesToHighRes(node, this.maxAnisotropy);
      }

      node.orbitPivot.getWorldPosition(_flyGoalTarget);
      const r = this.getBodyRadius(node.data);
      const viewDist =
        node.data.id === 'sun'
          ? r * 3.8
          : node.data.visual.rings
            ? r * 4.4
            : r * 3.5;

      _vA.subVectors(this.camera.position, this.controls.target);
      if (_vA.lengthSq() < 0.0001) {
        _vA.set(0.6, 0.35, 1.0);
      }
      _vA.normalize();
      _vA.y = THREE.MathUtils.clamp(_vA.y, 0.18, 0.52);
      _vA.normalize().multiplyScalar(viewDist);

      _flyGoalCamera.copy(_flyGoalTarget).add(_vA);
      this.controls.minDistance = Math.max(0.00001, r * 1.35);
      this.isFlying = true;
      this.hasTrackedPrev = false;
    } else {
      const proxy = this.nearbyStarProxies.find((s) => s.id === id);
      if (!proxy) return;

      this.ensureFocusedStarSystemFor(proxy);

      if (componentId) {
        const compSlot = this.starComponentSlots.find(
          (s) => s.pivot.visible && s.comp?.id === componentId && !s.comp.isVirtualBarycenter,
        );
        if (compSlot) {
          compSlot.surfaceMesh.getWorldPosition(_flyGoalTarget);
          const viewDist = Math.max(compSlot.worldRadius * 3.8, 0.04);
          _vA.subVectors(this.camera.position, this.controls.target);
          if (_vA.lengthSq() < 0.0001) _vA.set(0.4, 0.25, 0.9);
          _vA.normalize();
          _vA.y = THREE.MathUtils.clamp(_vA.y, 0.12, 0.48);
          _vA.normalize().multiplyScalar(viewDist);

          _flyGoalCamera.copy(_flyGoalTarget).add(_vA);
          this.controls.minDistance = Math.max(0.00005, compSlot.worldRadius * 1.32);
          this.isFlying = true;
          this.hasTrackedPrev = false;
          return;
        }
      }

      _flyGoalTarget.copy(proxy.position);
      const isOverview = proxy.overviewSpanUnits > 0;
      const viewDist = isOverview
        ? proxy.overviewSpanUnits * 1.38
        : Math.max(proxy.worldRadius * 3.8, 0.25);
      const minFocusR = Math.min(proxy.worldRadius, this.starComponentSlots[0]?.worldRadius || proxy.worldRadius);

      _vA.subVectors(this.camera.position, this.controls.target);
      if (_vA.lengthSq() < 0.0001) _vA.set(0.4, 0.35, 0.9);
      _vA.normalize();
      _vA.y = isOverview
        ? THREE.MathUtils.clamp(_vA.y, 0.28, 0.62)
        : THREE.MathUtils.clamp(_vA.y, 0.12, 0.48);
      _vA.normalize().multiplyScalar(viewDist);

      _flyGoalCamera.copy(_flyGoalTarget).add(_vA);
      this.controls.minDistance = Math.max(0.00005, minFocusR * 1.32);
      this.isFlying = true;
      this.hasTrackedPrev = false;
    }
  }

  public zoomToSolarOverview(): void {
    this.selectedId = null;
    this.selectedKind = null;
    this.selectedComponentId = null;
    this.hasTrackedPrev = false;
    this.callbacks.onSelectTarget(null, null, null);
    this.controls.minDistance = this.scaleMode === 'true' ? 0.00001 : 0.008;

    _flyGoalTarget.set(0, 0, 0);
    if (this.scaleMode === 'balanced') {
      _flyGoalCamera.set(0, 66, 142);
    } else {
      _flyGoalCamera.set(0, 1800, 4000);
    }
    this.isFlying = true;
  }

  public zoomToInterstellarView(): void {
    this.selectedId = null;
    this.selectedKind = null;
    this.selectedComponentId = null;
    this.hasTrackedPrev = false;
    this.callbacks.onSelectTarget(null, null, null);
    this.controls.minDistance = 0.005;

    const lyUnits = this.getLyToUnits();
    _flyGoalTarget.set(0, 0, 0);
    _flyGoalCamera.set(0, 11 * lyUnits, 27 * lyUnits);
    this.isFlying = true;
  }

  private updateOrbitalPositions(dt: number): void {
    const isPaused = this.timeSpeedDaysPerSec === 0;
    if (isPaused && this.simDays === this.lastPositionedSimDays) {
      return;
    }
    this.lastPositionedSimDays = this.simDays;

    const effectiveSpeed = THREE.MathUtils.clamp(this.timeSpeedDaysPerSec, -30, 30);

    for (let i = 0; i < this.solarEntries.length; i++) {
      const { body, node, cached } = this.solarEntries[i];

      if (body.parentId !== null) {
        const angle = body.initialAngleRad + this.simDays * cached.meanMotion;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const x = cached.semiMajor * cosA - cached.c;
        const zFlat = cached.b * sinA;
        node.orbitPivot.position.set(x, zFlat * cached.sinInc, zFlat * cached.cosInc);
      }

      if (cached.spinFactor !== 0 && !isPaused) {
        const spinDelta = dt * effectiveSpeed * cached.spinFactor;
        node.surfaceMesh.rotation.y += spinDelta;
        if (node.cloudMesh) {
          node.cloudMesh.rotation.y += spinDelta * 1.18 + Math.sign(effectiveSpeed) * dt * 0.002;
        }
      }
    }
  }

  /**
   * Syncs clickable hit-proxy sphere radii right before raycasts instead of every animation frame.
   */
  private syncHitProxiesForRaycast(): void {
    for (const node of this.planetNodes.values()) {
      node.orbitPivot.getWorldPosition(_vA);
      const distToCam = _vA.distanceTo(this.camera.position);
      const r = this.getBodyRadius(node.data);
      node.hitProxy.scale.setScalar(Math.max(r * 1.25, distToCam * 0.024));
    }

    const activeMultiResolved = Boolean(this.focusedStarGroup?.visible && this.activeFocusedStarId);
    for (let i = 0; i < this.nearbyStarProxies.length; i++) {
      const sp = this.nearbyStarProxies[i];
      const hideBaryProxy =
        activeMultiResolved &&
        sp.id === this.activeFocusedStarId &&
        Boolean(sp.star.components && sp.star.components.length > 0);
      sp.hitMesh.layers.set(hideBaryProxy ? 0 : 1);
      if (!hideBaryProxy) {
        const d = sp.position.distanceTo(this.camera.position);
        sp.hitMesh.scale.setScalar(Math.max(sp.worldRadius * 1.35, d * 0.022));
      }
    }

    for (let i = 0; i < this.starComponentSlots.length; i++) {
      const slot = this.starComponentSlots[i];
      const active = Boolean(
        this.focusedStarGroup?.visible &&
          slot.pivot.visible &&
          slot.comp &&
          !slot.comp.isVirtualBarycenter,
      );
      slot.hitMesh.layers.set(active ? 1 : 0);
      if (active) {
        slot.surfaceMesh.getWorldPosition(_vA);
        const distToCam = _vA.distanceTo(this.camera.position);
        slot.hitMesh.scale.setScalar(Math.max(slot.worldRadius * 1.4, distToCam * 0.025));
      }
    }
  }

  private updateFocusedStar3D(dt: number): void {
    if (!this.focusedStarGroup) return;

    let activeProxy: NearbyStarProxy | null = null;
    if (this.selectedId && this.selectedKind === 'nearby-star') {
      activeProxy = this.nearbyStarProxies.find((s) => s.id === this.selectedId) ?? null;
    }

    if (!activeProxy) {
      let bestRatio = 900;
      for (let i = 0; i < this.nearbyStarProxies.length; i++) {
        const sp = this.nearbyStarProxies[i];
        const d = sp.position.distanceTo(this.camera.position);
        const extent = Math.max(sp.worldRadius, sp.overviewSpanUnits * 0.5, 0.05);
        const ratio = d / extent;
        if (ratio < bestRatio) {
          bestRatio = ratio;
          activeProxy = sp;
        }
      }
    }

    if (!activeProxy) {
      this.focusedStarGroup.visible = false;
      if (this.nearbyStarMat) {
        this.nearbyStarMat.uniforms.uFocusedStarIndex.value = -1;
        this.nearbyStarMat.uniforms.uFocusedPointAlpha.value = 1;
      }
      return;
    }

    const distToCam = activeProxy.position.distanceTo(this.camera.position);
    const primaryExtent = Math.max(
      activeProxy.worldRadius,
      activeProxy.overviewSpanUnits * 0.5,
      0.05,
    );
    const ratio = distToCam / primaryExtent;
    const isActivelySelected =
      this.selectedKind === 'nearby-star' && this.selectedId === activeProxy.id;
    const maxResolveDist = isActivelySelected
      ? Math.max(primaryExtent * 900, activeProxy.maxOrbitUnits * 1.35 + 10000)
      : primaryExtent * 900;

    if (distToCam > maxResolveDist) {
      this.focusedStarGroup.visible = false;
      if (this.nearbyStarMat) {
        this.nearbyStarMat.uniforms.uFocusedStarIndex.value = -1;
        this.nearbyStarMat.uniforms.uFocusedPointAlpha.value = 1;
      }
      return;
    }

    this.focusedStarGroup.visible = true;
    this.ensureFocusedStarSystemFor(activeProxy);

    // Crossfade 2D sprite dot -> 3D resolved star system smoothly as camera closes in
    const pointAlpha = THREE.MathUtils.smoothstep(ratio, 24, 180);
    if (this.nearbyStarMat) {
      this.nearbyStarMat.uniforms.uFocusedStarIndex.value = activeProxy.index;
      this.nearbyStarMat.uniforms.uFocusedPointAlpha.value = pointAlpha;
    }

    const isMultiStar = Boolean(activeProxy.star.components && activeProxy.star.components.length > 0);
    const height = this.container.clientHeight || window.innerHeight;
    const fovScale = height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)));

    let closestCompRadius = activeProxy.worldRadius;
    let closestCompRatio = ratio;

    for (let i = 0; i < MAX_STAR_COMPONENTS; i++) {
      const slot = this.starComponentSlots[i];
      if (!slot.pivot.visible || !slot.comp) continue;

      if (slot.orbitLine) {
        (slot.orbitLine.material as THREE.ShaderMaterial).opacity =
          0.46 * (1 - pointAlpha * 0.85);
      }

      if (slot.comp.isVirtualBarycenter) continue;

      slot.surfaceMesh.rotation.y += dt * 0.045;
      slot.surfaceMat.uniforms.uTime.value = this.clock.elapsedTime;
      slot.coronaMat.uniforms.uTime.value = this.clock.elapsedTime;

      slot.surfaceMesh.getWorldPosition(_vA);
      _vB.subVectors(_vA, this.camera.position);
      const compDist = _vB.length();
      const compRatio = compDist / Math.max(slot.worldRadius, 0.001);
      if (compRatio < closestCompRatio) {
        closestCompRatio = compRatio;
        closestCompRadius = slot.worldRadius;
      }

      const sizeMult = this.settings.lensFlareSize;
      const strengthMult = this.settings.lensFlareStrength;
      const apparentPx = (slot.worldRadius / Math.max(compDist, 0.0001)) * fovScale;
      const lumWeight = isMultiStar
        ? THREE.MathUtils.clamp((Math.log10(Math.max(slot.comp.luminositySolar, 0.0005)) + 3.5) / 8.5, 0.28, 1.0)
        : THREE.MathUtils.clamp((8 - activeProxy.star.absoluteMag) / 14, 0.25, 1.0);

      const opticalPx = ((isMultiStar ? 10 : 16) + lumWeight * 18) * sizeMult;
      const flareRadiusPx = Math.min(
        Math.max(opticalPx, apparentPx * (1.1 + 0.34 * sizeMult) + 8 * sizeMult),
        height * Math.min(0.5, 0.28 * Math.max(sizeMult, 0.6)),
      );
      const closeDamp = 1 - THREE.MathUtils.smoothstep(apparentPx, 70, 185);
      const resolveFade = isMultiStar
        ? 1 - pointAlpha
        : THREE.MathUtils.smoothstep(apparentPx, 2, 16);
      const intensity =
        (isMultiStar ? 0.42 + lumWeight * 0.44 : 0.35 + lumWeight * 0.42) *
        closeDamp *
        resolveFade *
        strengthMult;

      if (intensity > 0.005 && sizeMult > 0.005 && compDist > slot.worldRadius * 1.05) {
        slot.flareMesh.visible = true;
        _vB.multiplyScalar(1 / compDist);
        // Place flare billboard cleanly behind star photosphere so close-up views never clip or z-fight
        const zOffset = slot.worldRadius * 1.02;
        slot.flareMesh.position.copy(_vB).multiplyScalar(zOffset);
        slot.flareMesh.quaternion.copy(this.camera.quaternion);
        const flareDist = compDist + zOffset;
        const worldSize = (2 * flareRadiusPx * flareDist) / Math.max(fovScale, 1);
        slot.flareMesh.scale.set(worldSize, worldSize, 1);
        slot.flareMat.uniforms.uTime.value = this.clock.elapsedTime;
        slot.flareMat.uniforms.uIntensity.value = intensity;
        slot.flareMat.uniforms.uStreak.value = 0.45 + lumWeight * 0.35;
      } else {
        slot.flareMesh.visible = false;
      }
    }

    // Allow manual zoom all the way down to any resolved companion or primary star photosphere
    if (!this.isFlying && this.selectedKind !== 'celestial' && (closestCompRatio < 260 || ratio < 260)) {
      this.controls.minDistance = Math.max(0.00005, closestCompRadius * 1.32);
    }
  }

  private updateFrameShadersAndRegime(camDistOrigin: number): void {
    // Sun photosphere & corona animation
    const sunNode = this.planetNodes.get('sun');
    if (sunNode) {
      if (sunNode.sunSurfaceMat) {
        sunNode.sunSurfaceMat.uniforms.uTime.value = this.clock.elapsedTime;
      }
      if (sunNode.sunCoronaMat) {
        sunNode.sunCoronaMat.uniforms.uTime.value = this.clock.elapsedTime;
      }
    }

    // Ring shadows for Saturn & Uranus when inside solar regime and visible
    const ringShadowCutoff = this.scaleMode === 'true' ? 28000 : 3200;
    if (camDistOrigin < ringShadowCutoff) {
      for (let i = 0; i < this.ringedNodes.length; i++) {
        const node = this.ringedNodes[i];
        if (node.tiltGroup.visible) {
          updateRingShadowUniforms(node, this.getBodyRadius(node.data));
        }
      }
    }

    if (this.asteroidBeltMesh) {
      const asteroidCutoff = this.scaleMode === 'true' ? 36000 : 1400;
      this.asteroidBeltMesh.visible = this.layers.asteroids && camDistOrigin < asteroidCutoff;
    }

    this.updateBodyFlares(camDistOrigin);
    this.updateLensFlare(camDistOrigin);

    // Keep sky dome centered on camera (constellations stay anchored in 3D space between member stars)
    if (this.skyDome) {
      this.skyDome.position.copy(this.camera.position);
      this.skyDome.updateMatrixWorld();
    }

    // Logarithmic distance blend so transitions span smoothly from outer planets to true light-years
    const logDist = Math.log10(Math.max(camDistOrigin, 1));
    const logBlendStart = this.scaleMode === 'true' ? 4.2 : 2.62;
    const logBlendEnd = this.scaleMode === 'true' ? 6.4 : 4.55;
    const interstellarBlend = THREE.MathUtils.smoothstep(logDist, logBlendStart, logBlendEnd);

    if (Math.abs(logDist - this.lastFadeDist) > 0.008) {
      this.lastFadeDist = logDist;

      if (this.nearbyStarMat) {
        this.nearbyStarMat.uniforms.uBoost.value = 0.8 + interstellarBlend * 1.25;
      }
      if (this.heliosphereMat) {
        const helioFadeIn = THREE.MathUtils.smoothstep(
          logDist,
          this.scaleMode === 'true' ? 4.15 : 2.48,
          this.scaleMode === 'true' ? 4.7 : 3.9,
        );
        const helioFadeOut =
          1 -
          THREE.MathUtils.smoothstep(
            logDist,
            this.scaleMode === 'true' ? 6.4 : 5.4,
            this.scaleMode === 'true' ? 7.5 : 6.5,
          );
        this.heliosphereMat.opacity = helioFadeIn * helioFadeOut * 0.34;
        if (this.heliosphereRing) {
          this.heliosphereRing.visible = this.heliosphereMat.opacity > 0.002;
        }
      }
      if (this.constellationMat) {
        this.constellationMat.opacity = this.layers.constellations
          ? 0.14 + interstellarBlend * 0.28
          : 0;
        if (this.constellationLines) {
          this.constellationLines.visible =
            this.layers.constellations && this.constellationMat.opacity > 0.002;
        }
      }
    }

    if (this.layers.orbits) {
      const orbitOpacity = 0.34 * (1 - interstellarBlend * 0.88);
      const moonFadeStart = this.scaleMode === 'balanced' ? 52 : 8;
      const moonFadeEnd = this.scaleMode === 'balanced' ? 190 : 85;
      const selectedParentId =
        this.selectedKind === 'celestial' && this.selectedId
          ? this.planetNodes.get(this.selectedId)?.data.parentId ?? null
          : null;

      for (let i = 0; i < this.solarEntries.length; i++) {
        const { body, node, parentNode } = this.solarEntries[i];
        if (!node.orbitLine) continue;
        if (body.category === 'dwarf' && !this.layers.dwarfOrbits) {
          node.orbitLine.visible = false;
          continue;
        }
        const isDirectlySelected = this.selectedKind === 'celestial' && this.selectedId === body.id;
        const mat = node.orbitLine.material as THREE.ShaderMaterial;

        if (body.category === 'moon') {
          const isParentOrMoonSelected =
            isDirectlySelected ||
            (this.selectedKind === 'celestial' && this.selectedId === body.parentId);
          if (isParentOrMoonSelected) {
            mat.opacity = Math.max(orbitOpacity, 0.36);
          } else if (parentNode) {
            _vA.setFromMatrixPosition(parentNode.orbitPivot.matrixWorld);
            const distToParent = _vA.distanceTo(this.camera.position);
            const moonFade = 1 - THREE.MathUtils.smoothstep(distToParent, moonFadeStart, moonFadeEnd);
            mat.opacity = orbitOpacity * moonFade;
          } else {
            mat.opacity = 0;
          }
        } else if (body.category === 'dwarf') {
          const hasSelectedMoon = selectedParentId === body.id;
          if (isDirectlySelected || hasSelectedMoon) {
            mat.opacity = Math.max(orbitOpacity, 0.42);
          } else {
            mat.opacity = orbitOpacity * (body.isDwarfCandidate ? 0.28 : 0.52);
          }
        } else {
          mat.opacity = isDirectlySelected ? Math.max(orbitOpacity, 0.42) : orbitOpacity;
        }

        node.orbitLine.visible = mat.opacity > 0.002;
      }
    }
  }

  private updateBodyFlares(camDistOrigin: number): void {
    if (
      !this.bodyFlareMesh ||
      !this.bodyFlareMat ||
      !this.bodyFlareIntensityAttr ||
      !this.bodyFlareStreakAttr
    ) {
      return;
    }

    const height = this.container.clientHeight || window.innerHeight;
    const fovScale = height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)));
    const auUnits = this.scaleMode === 'true' ? TRUE_AU_TO_UNITS : 32.5;
    const blendStart = this.scaleMode === 'true' ? 16000 : 420;
    const blendEnd = this.scaleMode === 'true' ? 52000 : 28000;
    const interstellarFade = 1 - THREE.MathUtils.smoothstep(camDistOrigin, blendStart, blendEnd) * 0.78;

    const q = THREE.MathUtils.clamp(this.settings.quality, 0.25, 1);
    const subPixelCutoff = 0.14 + (1 - q) * 0.85;
    const atmoPxCutoff = 1.0 + (1 - q) * 3.5;

    const sizeMult = this.settings.lensFlareSize;
    const strengthMult = this.settings.lensFlareStrength;
    const flaresEnabled = sizeMult > 0.005 && strengthMult > 0.005;

    this.camera.getWorldDirection(_camForward);
    if (flaresEnabled) {
      this.bodyFlareMat.uniforms.uTime.value = this.clock.elapsedTime;
    }

    const intensities = this.bodyFlareIntensityAttr.array as Float32Array;
    const streaks = this.bodyFlareStreakAttr.array as Float32Array;
    let anyActiveFlare = false;

    for (let i = 0; i < this.solarEntries.length; i++) {
      const { body, node } = this.solarEntries[i];

      _vA.setFromMatrixPosition(node.orbitPivot.matrixWorld);
      _vB.subVectors(_vA, this.camera.position);
      const distToCam = _vB.length();
      const bodyRadius = this.getBodyRadius(body);
      const apparentRadiusPx =
        distToCam > 0.000001 ? (bodyRadius / distToCam) * fovScale : 9999;

      // Sub-pixel LOD culling skips invisible <0.14px sphere draws while preserving clouds/selection
      const isSubPixelCulled =
        body.id !== 'sun' && this.selectedId !== body.id && apparentRadiusPx < subPixelCutoff;
      node.tiltGroup.visible = !isSubPixelCulled;
      if (node.atmosphereMesh) {
        node.atmosphereMesh.visible = !isSubPixelCulled && apparentRadiusPx >= atmoPxCutoff;
      }
      if (node.atmosphereVeilMesh) {
        node.atmosphereVeilMesh.visible = !isSubPixelCulled && apparentRadiusPx >= atmoPxCutoff;
      }
      if (node.cloudMesh) {
        node.cloudMesh.visible =
          !isSubPixelCulled && Boolean(node.cloudMat?.map || node.cloudMat?.alphaMap);
      }

      if (!flaresEnabled || distToCam <= bodyRadius * 1.05 || _vB.dot(_camForward) <= 0) {
        intensities[i] = 0;
        continue;
      }

      let flareRadiusPx = 0;
      let intensity = 0;
      let streak = 0.2;

      if (body.id === 'sun') {
        const deltaAU = distToCam / auUnits;
        const sunAppMag = -26.74 + 5 * Math.log10(Math.max(1e-5, deltaAU));
        const opticalPx =
          THREE.MathUtils.clamp(22 + Math.max(0, (-14 - sunAppMag) * 1.15), 14, 42) * sizeMult;
        flareRadiusPx = Math.min(
          Math.max(opticalPx, apparentRadiusPx * (1.1 + 0.36 * sizeMult) + 8 * sizeMult),
          height * Math.min(0.55, 0.28 * Math.max(sizeMult, 0.6)),
        );
        // Smoothly fade starburst out as the solar disk resolves up close (3D corona takes over)
        const closeDamp = 1 - THREE.MathUtils.smoothstep(apparentRadiusPx, 75, 185);
        intensity =
          THREE.MathUtils.clamp(
            0.42 + Math.pow(bodyRadius / Math.max(distToCam, bodyRadius * 1.15), 0.14) * 0.42,
            0.22,
            0.78,
          ) *
          closeDamp *
          interstellarFade *
          strengthMult;
        streak = 0.8;
      } else {
        // Point-source diffraction flare fades out completely once the world/moon resolves into a close-up sphere
        const closeDamp = 1 - THREE.MathUtils.smoothstep(apparentRadiusPx, 8, 38);
        if (closeDamp <= 0.002) {
          intensities[i] = 0;
          continue;
        }

        const sunDist = _vA.length();
        const rAU = sunDist / auUnits;
        const deltaAU = distToCam / auUnits;

        // Solar phase angle: 0 = full lit phase, pi = dark night side
        _rayDir.copy(_vA).multiplyScalar(-1 / Math.max(sunDist, 0.0001));
        _toBody.copy(_vB).multiplyScalar(-1 / distToCam);
        const cosAlpha = THREE.MathUtils.clamp(_rayDir.dot(_toBody), -1, 1);
        const alpha = Math.acos(cosAlpha);
        const phase = (Math.sin(alpha) + (Math.PI - alpha) * cosAlpha) / Math.PI;

        if (phase <= 0.008) {
          intensities[i] = 0;
          continue;
        }

        // Apparent planetary magnitude V = H + 5*log10(r * delta) - 2.5*log10(phase)
        const appMag =
          body.absMag +
          5 * Math.log10(Math.max(1e-7, rAU * deltaAU)) -
          2.5 * Math.log10(Math.max(1e-4, phase));

        if (appMag >= 8.5) {
          intensities[i] = 0;
          continue;
        }

        const magNorm = THREE.MathUtils.clamp((8.5 - appMag) / 18.5, 0, 1);
        const flux = Math.pow(magNorm, 1.5);
        const opticalPx = (3.5 + flux * 24) * sizeMult;
        flareRadiusPx = Math.min(
          Math.max(opticalPx, apparentRadiusPx * (1.05 + 0.25 * sizeMult) + opticalPx * 0.22),
          height * Math.min(0.45, 0.24 * Math.max(sizeMult, 0.6)),
        );
        intensity = flux * 0.68 * closeDamp * interstellarFade * strengthMult;
        streak = THREE.MathUtils.clamp(flux * 0.85, 0.08, 0.7);
      }

      if (intensity <= 0.003) {
        intensities[i] = 0;
        continue;
      }

      anyActiveFlare = true;
      intensities[i] = intensity;
      streaks[i] = streak;

      // Place flare billboard strictly behind the emitting body's back hemisphere so tiny objects up close never z-fight or clip
      _vB.multiplyScalar(1 / distToCam);
      const zOffset = bodyRadius * 1.05;
      _flarePos.copy(_vA).addScaledVector(_vB, zOffset);
      const flareDist = distToCam + zOffset;
      const worldSize = (2 * flareRadiusPx * flareDist) / Math.max(fovScale, 1);
      _flareScale.set(worldSize, worldSize, 1);
      _flareDummyMat.compose(_flarePos, this.camera.quaternion, _flareScale);
      this.bodyFlareMesh.setMatrixAt(i, _flareDummyMat);
    }

    this.bodyFlareMesh.visible = anyActiveFlare;
    if (anyActiveFlare || this.hadActiveBodyFlares) {
      this.bodyFlareMesh.instanceMatrix.needsUpdate = true;
      this.bodyFlareIntensityAttr.needsUpdate = true;
      this.bodyFlareStreakAttr.needsUpdate = true;
    }
    this.hadActiveBodyFlares = anyActiveFlare;
  }

  private updateLensFlare(camDistOrigin: number): void {
    if (!this.lensFlareMesh || !this.lensFlareMat) return;

    if (this.settings.lensFlareStrength <= 0.005 || this.settings.lensFlareSize <= 0.005) {
      this.lensFlareMesh.visible = false;
      return;
    }

    this.camera.getWorldDirection(_camForward);
    _rayDir.copy(this.camera.position).negate();
    const distToSun = _rayDir.length();
    if (distToSun < 0.0001) {
      this.lensFlareMesh.visible = false;
      return;
    }
    _rayDir.multiplyScalar(1 / distToSun);

    const forwardDot = _rayDir.dot(_camForward);
    if (forwardDot <= 0.08) {
      this.lensFlareMesh.visible = false;
      return;
    }

    _sunNdc.set(0, 0, 0).project(this.camera);
    if (_sunNdc.z > 1) {
      this.lensFlareMesh.visible = false;
      return;
    }

    const edgeMax = Math.max(Math.abs(_sunNdc.x), Math.abs(_sunNdc.y));
    const edgeFade = 1 - THREE.MathUtils.smoothstep(edgeMax, 0.88, 1.32);
    if (edgeFade <= 0.005) {
      this.lensFlareMesh.visible = false;
      return;
    }

    // Exact spherical angular eclipse occlusion along camera -> Sun ray (stable at all distances & angles)
    const sunBody = BODY_MAP.get('sun');
    const sunRadius = sunBody ? this.getBodyRadius(sunBody) : 1.49;
    const sunTheta = Math.asin(Math.min(1, sunRadius / distToSun));
    let occlusion = 1.0;

    for (let i = 0; i < this.solarEntries.length; i++) {
      const { body, node } = this.solarEntries[i];
      if (body.id === 'sun') continue;

      _vA.setFromMatrixPosition(node.orbitPivot.matrixWorld);
      _toBody.subVectors(_vA, this.camera.position);
      const d = _toBody.length();
      const bodyRadius = this.getBodyRadius(body);
      if (d <= bodyRadius) {
        occlusion = 0;
        break;
      }
      const t = _toBody.dot(_rayDir);
      if (t <= 0 || t >= distToSun) continue;

      const bodyTheta = Math.asin(Math.min(1, bodyRadius / d));
      if (bodyTheta <= sunTheta * 0.25) continue;

      const rayTheta = Math.acos(THREE.MathUtils.clamp(t / d, -1, 1));
      if (rayTheta < bodyTheta + sunTheta) {
        const cover = THREE.MathUtils.smoothstep(
          rayTheta,
          Math.max(0, bodyTheta - sunTheta * 0.35),
          bodyTheta + sunTheta * 0.9,
        );
        occlusion = Math.min(occlusion, cover);
        if (occlusion <= 0.01) break;
      }
    }

    if (occlusion <= 0.01) {
      this.lensFlareMesh.visible = false;
      return;
    }

    const blendStart = this.scaleMode === 'true' ? 16000 : 420;
    const blendEnd = this.scaleMode === 'true' ? 52000 : 28000;
    const interstellarFade = 1 - THREE.MathUtils.smoothstep(camDistOrigin, blendStart, blendEnd * 2.5);
    if (interstellarFade <= 0.005) {
      this.lensFlareMesh.visible = false;
      return;
    }
    const distanceFactor = THREE.MathUtils.clamp(
      Math.pow(sunRadius / Math.max(distToSun, sunRadius * 1.15), 0.14) * 0.82,
      0.12,
      0.75,
    );

    const intensity =
      edgeFade * occlusion * interstellarFade * distanceFactor * this.settings.lensFlareStrength;
    if (intensity <= 0.005) {
      this.lensFlareMesh.visible = false;
      return;
    }

    this.lensFlareMesh.visible = true;
    this.lensFlareMat.uniforms.uSunScreen.value.set(
      (_sunNdc.x + 1) * 0.5,
      (_sunNdc.y + 1) * 0.5,
    );
    this.lensFlareMat.uniforms.uIntensity.value = intensity;
    this.lensFlareMat.uniforms.uSize.value = this.settings.lensFlareSize;
  }

  private updateCameraTrackingAndFlight(dt: number): void {
    if (this.selectedId && this.selectedKind === 'celestial') {
      const node = this.planetNodes.get(this.selectedId);
      if (node) {
        node.orbitPivot.getWorldPosition(_currTrackedWorld);
        if (this.hasTrackedPrev) {
          _deltaTracked.subVectors(_currTrackedWorld, _prevTrackedWorld);
          this.controls.target.add(_deltaTracked);
          this.camera.position.add(_deltaTracked);
          if (this.isFlying) {
            _flyGoalTarget.add(_deltaTracked);
            _flyGoalCamera.add(_deltaTracked);
          }
        }
        _prevTrackedWorld.copy(_currTrackedWorld);
        this.hasTrackedPrev = true;
      }
    } else if (this.selectedId && this.selectedKind === 'nearby-star') {
      const sp = this.nearbyStarProxies.find((s) => s.id === this.selectedId);
      if (sp) {
        if (this.selectedComponentId && this.focusedStarGroup?.visible) {
          const compSlot = this.starComponentSlots.find(
            (s) => s.pivot.visible && s.comp?.id === this.selectedComponentId && !s.comp.isVirtualBarycenter,
          );
          if (compSlot) {
            compSlot.surfaceMesh.getWorldPosition(_currTrackedWorld);
            if (this.hasTrackedPrev) {
              _deltaTracked.subVectors(_currTrackedWorld, _prevTrackedWorld);
              this.controls.target.add(_deltaTracked);
              this.camera.position.add(_deltaTracked);
              if (this.isFlying) {
                _flyGoalTarget.add(_deltaTracked);
                _flyGoalCamera.add(_deltaTracked);
              }
            }
            _prevTrackedWorld.copy(_currTrackedWorld);
            this.hasTrackedPrev = true;
          }
        }
      }
    }

    if (this.isFlying) {
      const errBefore =
        this.controls.target.distanceTo(_flyGoalTarget) +
        this.camera.position.distanceTo(_flyGoalCamera);
      const goalSpan = Math.max(_flyGoalCamera.distanceTo(_flyGoalTarget), 0.001);
      // Warp smoothly faster across vast light-year voids, then decelerate gently on orbital arrival
      const distRatio = errBefore / goalSpan;
      const dampLambda = distRatio > 25 ? 8.8 : 5.5;

      this.controls.target.x = THREE.MathUtils.damp(
        this.controls.target.x,
        _flyGoalTarget.x,
        dampLambda,
        dt,
      );
      this.controls.target.y = THREE.MathUtils.damp(
        this.controls.target.y,
        _flyGoalTarget.y,
        dampLambda,
        dt,
      );
      this.controls.target.z = THREE.MathUtils.damp(
        this.controls.target.z,
        _flyGoalTarget.z,
        dampLambda,
        dt,
      );

      this.camera.position.x = THREE.MathUtils.damp(
        this.camera.position.x,
        _flyGoalCamera.x,
        dampLambda,
        dt,
      );
      this.camera.position.y = THREE.MathUtils.damp(
        this.camera.position.y,
        _flyGoalCamera.y,
        dampLambda,
        dt,
      );
      this.camera.position.z = THREE.MathUtils.damp(
        this.camera.position.z,
        _flyGoalCamera.z,
        dampLambda,
        dt,
      );

      const err =
        this.controls.target.distanceTo(_flyGoalTarget) +
        this.camera.position.distanceTo(_flyGoalCamera);
      const stopThreshold = Math.max(0.000004, goalSpan * 0.004);
      if (err < stopThreshold) {
        this.isFlying = false;
        const prevDamping = this.controls.enableDamping;
        this.controls.enableDamping = false;
        this.controls.update();
        this.controls.enableDamping = prevDamping;
      } else {
        this.camera.lookAt(this.controls.target);
      }
    } else {
      if (!this.isSoftwareGl) {
        this.controls.dampingFactor = 1 - Math.pow(1 - 0.085, Math.max(dt, 0.001) * 60);
      }
      this.controls.update();
    }

    const targetDist = this.camera.position.distanceTo(this.controls.target);
    const desiredNear = THREE.MathUtils.clamp(targetDist * 0.002, 0.000004, 1500);
    if (Math.abs(this.camera.near - desiredNear) / this.camera.near > 0.35) {
      this.camera.near = desiredNear;
      this.camera.updateProjectionMatrix();
    }
  }

  private updateScreenMarkers(): void {
    if (!this.layers.labels) {
      if (!this.markersCleared) {
        this.markerBuffer.length = 0;
        this.callbacks.onMarkersFrame(this.markerBuffer);
        this.markersCleared = true;
      }
      return;
    }
    this.markersCleared = false;

    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.getWorldDirection(_camForward);
    const camOriginDist = this.camera.position.length();

    let count = 0;
    const ensureSlot = (idx: number): MarkerProjection => {
      if (!this.markerBuffer[idx]) {
        this.markerBuffer[idx] = {
          id: '',
          name: '',
          subtitle: '',
          kind: 'celestial',
          x: 0,
          y: 0,
          visible: false,
          opacity: 0,
          color: '#06B6D4',
          isSelected: false,
        };
      }
      return this.markerBuffer[idx];
    };

    const fovScale = height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)));
    const placedSolarXs = this.scratchSolarXs;
    const placedSolarYs = this.scratchSolarYs;
    placedSolarXs.length = 0;
    placedSolarYs.length = 0;

    // Bucket bodies by priority in a single scan instead of iterating solarEntries 4 times
    // 0: selected, hovered, or Sun; 1: planets; 2: official dwarf planets; 3: candidates & nearby moons
    this.solarPassBuckets[0].length = 0;
    this.solarPassBuckets[1].length = 0;
    this.solarPassBuckets[2].length = 0;
    this.solarPassBuckets[3].length = 0;
    for (let i = 0; i < this.solarEntries.length; i++) {
      const { body } = this.solarEntries[i];
      const isSelOrHov = this.selectedId === body.id || this.hoveredId === body.id;
      const tier =
        isSelOrHov || body.id === 'sun'
          ? 0
          : body.category === 'planet'
            ? 1
            : body.category === 'dwarf' && !body.isDwarfCandidate
              ? 2
              : 3;
      this.solarPassBuckets[tier].push(i);
    }

    for (let solarPass = 0; solarPass < 4; solarPass++) {
      const bucket = this.solarPassBuckets[solarPass];
      for (let b = 0; b < bucket.length; b++) {
        const i = bucket[b];
        const { body, node } = this.solarEntries[i];
        const isSelOrHov = this.selectedId === body.id || this.hoveredId === body.id;
        const tier = solarPass;

        _vA.setFromMatrixPosition(node.orbitPivot.matrixWorld);
        _vB.subVectors(_vA, this.camera.position);
        const distToCam = _vB.length();
        if (_vB.dot(_camForward) <= 0) continue;

        let opacity = 1;
        if (body.category === 'moon') {
          const isParentOrMoonSelected =
            this.selectedId === body.id || this.selectedId === body.parentId;
          const threshold = this.scaleMode === 'balanced' ? 48 : 22;
          if (!isParentOrMoonSelected && distToCam > threshold) {
            continue;
          }
          opacity = isParentOrMoonSelected
            ? 0.95
            : 1 - THREE.MathUtils.smoothstep(distToCam, threshold * 0.6, threshold);
        } else if (body.id !== 'sun') {
          const planetFadeStart = this.scaleMode === 'true' ? 16000 : 1200;
          const planetFadeEnd = this.scaleMode === 'true' ? 42000 : 6000;
          opacity = 1 - THREE.MathUtils.smoothstep(camOriginDist, planetFadeStart, planetFadeEnd);
          if (body.isDwarfCandidate && !isSelOrHov) {
            opacity *= 0.72;
          }
        }

        if (opacity <= 0.03) continue;

        _vC.copy(_vA).project(this.camera);
        if (_vC.z > 1) continue;

        const bodyRadius = this.getBodyRadius(body);
        const apparentPx = (bodyRadius / Math.max(distToCam, 0.00001)) * fovScale;
        const offsetAbovePx = Math.min(Math.max(apparentPx * 1.12 + 8, 10), height * 0.36);

        const sx = (_vC.x + 1) * 0.5 * width;
        const sy = (-_vC.y + 1) * 0.5 * height - offsetAbovePx;
        if (sx < -80 || sx > width + 80 || sy < -50 || sy > height + 50) continue;

        if (tier >= 2) {
          let blocked = false;
          for (let j = 0; j < placedSolarXs.length; j++) {
            if (Math.abs(placedSolarXs[j] - sx) < 72 && Math.abs(placedSolarYs[j] - sy) < 18) {
              blocked = true;
              break;
            }
          }
          if (blocked) continue;
        }

        placedSolarXs.push(sx);
        placedSolarYs.push(sy);

        const slot = ensureSlot(count++);
        slot.id = body.id;
        slot.componentId = undefined;
        const solLabelThreshold = this.scaleMode === 'true' ? 20000 : 1800;
        slot.name = body.id === 'sun' && camOriginDist > solLabelThreshold ? 'Sol (Solar System)' : body.name;
        slot.subtitle =
          body.category === 'moon'
            ? 'Moon'
            : body.category === 'dwarf'
              ? body.isDwarfCandidate
                ? 'Candidate'
                : 'Dwarf'
              : body.telemetry.distanceLabel.split(' ')[0];
        slot.kind = 'celestial';
        slot.x = sx;
        slot.y = sy;
        slot.visible = true;
        slot.opacity = opacity;
        slot.color = body.orbitColor;
        slot.isSelected = this.selectedId === body.id;
      }
    }

    const logDist = Math.log10(Math.max(camOriginDist, 1));
    const starLabelFade = THREE.MathUtils.smoothstep(
      logDist,
      this.scaleMode === 'true' ? 4.35 : 2.75,
      this.scaleMode === 'true' ? 6.2 : 4.2,
    );
    const pointAlpha = this.nearbyStarMat
      ? (this.nearbyStarMat.uniforms.uFocusedPointAlpha.value as number)
      : 1;

    if (starLabelFade > 0.05 || this.selectedKind === 'nearby-star' || this.hoveredId !== null) {
      const lyUnits = this.getLyToUnits();
      const placedStarXs = this.scratchStarXs;
      const placedStarYs = this.scratchStarYs;
      placedStarXs.length = 0;
      placedStarYs.length = 0;

      // Pass 0: selected/hovered stars first; Pass 1: primary landmarks/nearby stars
      for (let starPass = 0; starPass < 2; starPass++) {
        for (let i = 0; i < NEARBY_STARS.length; i++) {
          const star = NEARBY_STARS[i];
          const isSel = this.selectedId === star.id;
          const isHov = this.hoveredId === star.id;
          const isPriority = isSel || isHov;
          if ((starPass === 0 && !isPriority) || (starPass === 1 && isPriority)) {
            continue;
          }

          const proxy = this.nearbyStarProxies[i];
          const isResolvedMulti =
            Boolean(
              this.focusedStarGroup?.visible &&
                this.activeFocusedStarId === star.id &&
                star.components &&
                star.components.length > 0,
            ) &&
            (pointAlpha < 0.75 || (isSel && this.selectedComponentId !== null));

          if (isResolvedMulti) {
            const placedXs = this.scratchCompXs;
            const placedYs = this.scratchCompYs;
            placedXs.length = 0;
            placedYs.length = 0;

            // Emit active selected component first so it always wins overlap checks
            for (let pass = 0; pass < 2; pass++) {
              for (let k = 0; k < MAX_STAR_COMPONENTS; k++) {
                const compSlot = this.starComponentSlots[k];
                if (!compSlot.pivot.visible || !compSlot.comp || compSlot.comp.isVirtualBarycenter) {
                  continue;
                }
                const isCompSelected = isSel && this.selectedComponentId === compSlot.comp.id;
                if ((pass === 0 && !isCompSelected) || (pass === 1 && isCompSelected)) {
                  continue;
                }

                compSlot.surfaceMesh.getWorldPosition(_vA);
                _vB.subVectors(_vA, this.camera.position);
                const distToCam = _vB.length();
                if (_vB.dot(_camForward) <= 0) continue;

                _vC.copy(_vA).project(this.camera);
                if (_vC.z > 1) continue;

                const apparentPx = (compSlot.worldRadius / Math.max(distToCam, 0.0001)) * fovScale;
                const offsetAbovePx = Math.min(Math.max(apparentPx * 1.12 + 8, 12), height * 0.36);

                const sx = (_vC.x + 1) * 0.5 * width;
                const sy = (-_vC.y + 1) * 0.5 * height - offsetAbovePx;
                if (sx < -60 || sx > width + 60 || sy < -40 || sy > height + 40) continue;

                let crowded = false;
                for (let p = 0; p < placedXs.length; p++) {
                  if (Math.abs(sx - placedXs[p]) < 64 && Math.abs(sy - placedYs[p]) < 16) {
                    crowded = true;
                    break;
                  }
                }
                if (crowded) continue;

                placedXs.push(sx);
                placedYs.push(sy);

                const marker = ensureSlot(count++);
                marker.id = `${star.id}::${compSlot.comp.id}`;
                marker.componentId = compSlot.comp.id;
                marker.name = compSlot.comp.name;
                marker.subtitle = compSlot.comp.spectralClass;
                marker.kind = 'nearby-star';
                marker.x = sx;
                marker.y = sy;
                marker.visible = true;
                marker.opacity = isCompSelected ? 1 : 0.92;
                marker.color = compSlot.comp.orbitColor;
                marker.isSelected = isCompSelected;
              }
            }
            continue;
          }

          _vB.subVectors(proxy.position, this.camera.position);
          const distToCam = _vB.length();
          if (_vB.dot(_camForward) <= 0) continue;

          const isLandmark =
            CORE_NEARBY_STAR_IDS.has(star.id) ||
            star.apparentMag <= 1.65 ||
            distToCam < 3.0 * lyUnits;
          if (!isPriority && (!isLandmark || starLabelFade <= 0.05)) continue;

          _vC.copy(proxy.position).project(this.camera);
          if (_vC.z > 1) continue;

          const apparentPx = (proxy.worldRadius / Math.max(distToCam, 0.001)) * fovScale;
          const offsetAbovePx = Math.min(Math.max(apparentPx * 1.12 + 8, 10), height * 0.36);

          const sx = (_vC.x + 1) * 0.5 * width;
          const sy = (-_vC.y + 1) * 0.5 * height - offsetAbovePx;
          if (sx < -60 || sx > width + 60 || sy < -40 || sy > height + 40) continue;

          if (!isPriority) {
            let crowded = false;
            for (let p = 0; p < placedStarXs.length; p++) {
              if (Math.abs(sx - placedStarXs[p]) < 56 && Math.abs(sy - placedStarYs[p]) < 15) {
                crowded = true;
                break;
              }
            }
            if (crowded) continue;
          }

          placedStarXs.push(sx);
          placedStarYs.push(sy);

          const slot = ensureSlot(count++);
          slot.id = star.id;
          slot.componentId = undefined;
          slot.name = star.name;
          slot.subtitle = `${star.distanceLy.toFixed(1)} ly`;
          slot.kind = 'nearby-star';
          slot.x = sx;
          slot.y = sy;
          slot.visible = true;
          slot.opacity = isPriority ? 1 : starLabelFade * 0.88;
          slot.color = star.color;
          slot.isSelected = isSel;
        }
      }
    }

    this.markerBuffer.length = count;
    this.callbacks.onMarkersFrame(this.markerBuffer);
  }

  private tick = (): void => {
    if (this.disposed) return;

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.simDays += dt * this.timeSpeedDaysPerSec;

    this.updateOrbitalPositions(dt);
    this.updateFocusedStar3D(dt);
    this.scene.updateMatrixWorld(false);
    this.updateCameraTrackingAndFlight(dt);
    this.camera.updateMatrixWorld();

    const camOriginDist = this.camera.position.length();
    this.updateFrameShadersAndRegime(camOriginDist);

    if (this.asteroidBeltMesh && this.layers.asteroids && this.timeSpeedDaysPerSec !== 0) {
      const beltFactor = THREE.MathUtils.clamp(this.timeSpeedDaysPerSec, -15, 15);
      this.asteroidBeltMesh.rotation.y += dt * 0.006 * beltFactor;
      this.asteroidBeltMesh.updateMatrixWorld();
    }

    this.renderer.render(this.scene, this.camera);
    this.updateScreenMarkers();

    const now = performance.now();
    if (now - this.lastHudNotifyTime > 100) {
      this.lastHudNotifyTime = now;
      this.callbacks.onSimTimeTick(this.simDays);

      const interstellarThreshold = this.scaleMode === 'true' ? 120000 : 12000;
      const targetDist = this.camera.position.distanceTo(this.controls.target);
      const selBody =
        this.selectedId && this.selectedKind === 'celestial' ? BODY_MAP.get(this.selectedId) : null;
      const selRadius = selBody ? this.getBodyRadius(selBody) : 1;
      const newRegime: CameraRegime =
        camOriginDist > interstellarThreshold || this.selectedKind === 'nearby-star'
          ? 'interstellar'
          : this.selectedId && targetDist < Math.max(28, selRadius * 20)
            ? 'planet'
            : 'solar';
      this.currentRegime = newRegime;
      this.callbacks.onRegimeChange(this.currentRegime, camOriginDist);
    }

    if (this.isSoftwareGl) {
      this.scheduleAfterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private scheduleAfterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (gl && typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = window.setTimeout(cb, 80);
    }
  }

  private startLoop(): void {
    this.clock.start();
    if (this.isSoftwareGl) {
      this.frameId = window.setTimeout(this.tick, 16);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  }

  private onResize = (): void => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    const pr = this.getEffectivePixelRatio();
    this.renderer.setPixelRatio(pr);
    if (this.nearbyStarMat) this.nearbyStarMat.uniforms.uPixelRatio.value = pr;
    if (this.lensFlareMat) {
      this.lensFlareMat.uniforms.uAspect.value = width / Math.max(height, 1);
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = (e: PointerEvent): void => {
    const moveDist = Math.hypot(
      e.clientX - this.pointerDownPos.x,
      e.clientY - this.pointerDownPos.y,
    );
    if (moveDist > 5) return;

    this.syncHitProxiesForRaycast();

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(this.clickableMeshes, false);

    if (hits.length > 0) {
      const hit = hits[0].object;
      const targetId = hit.userData.targetId as string;
      const kind = hit.userData.kind as 'celestial' | 'nearby-star';
      const componentId = hit.userData.componentId as string | undefined;
      this.selectAndFlyTo(targetId, kind, componentId ?? null);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.buttons !== 0 || this.isFlying) return;
    const now = performance.now();
    if (now - this.lastHoverRaycast < 90) return;
    this.lastHoverRaycast = now;

    this.syncHitProxiesForRaycast();

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(this.clickableMeshes, false);

    if (hits.length > 0) {
      const hit = hits[0].object;
      const id = hit.userData.targetId as string;
      const kind = hit.userData.kind as 'celestial' | 'nearby-star';
      if (this.hoveredId !== id) {
        this.hoveredId = id;
        this.renderer.domElement.style.cursor = 'pointer';
        this.callbacks.onHoverTarget(id, kind);
      }
    } else if (this.hoveredId !== null) {
      this.hoveredId = null;
      this.renderer.domElement.style.cursor = 'grab';
      this.callbacks.onHoverTarget(null, null);
    }
  };

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.callbacks.onWebGLContextLost(true);
  };

  private onContextRestored = (): void => {
    this.callbacks.onWebGLContextLost(false);
  };

  private bindEvents(): void {
    const dom = this.renderer.domElement;
    dom.style.cursor = 'grab';
    window.addEventListener('resize', this.onResize);
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('webglcontextlost', this.onContextLost);
    dom.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    if (this.bakeTimerId !== null) {
      clearTimeout(this.bakeTimerId);
      this.bakeTimerId = null;
    }
    this.pendingBakeNodes.length = 0;

    const dom = this.renderer.domElement;
    window.removeEventListener('resize', this.onResize);
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('pointermove', this.onPointerMove);
    dom.removeEventListener('webglcontextlost', this.onContextLost);
    dom.removeEventListener('webglcontextrestored', this.onContextRestored);

    this.controls.dispose();

    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).geometry) {
        (obj as THREE.Mesh).geometry.dispose();
      }
      const mat = (obj as THREE.Mesh).material;
      if (Array.isArray(mat)) {
        mat.forEach((m) => m.dispose());
      } else if (mat) {
        mat.dispose();
      }
    });

    this.skyCubeTarget?.dispose();
    this.skyCubeTarget = null;

    for (const node of this.planetNodes.values()) {
      node.externalTexture?.dispose();
      node.externalCloudTexture?.dispose();
      node.externalNightTexture?.dispose();
      node.externalHeightNormalTexture?.dispose();
      node.textures?.albedoMap.dispose();
      node.textures?.normalMap.dispose();
      node.textures?.roughnessMap?.dispose();
      node.textures?.cloudMap?.dispose();
      node.textures?.nightLightsMap?.dispose();
      node.textures?.ringMap?.dispose();
    }

    this.renderer.dispose();
    if (dom.parentNode === this.container) {
      this.container.removeChild(dom);
    }
  }
}

export function formatJ2000ToUtcString(simDays: number): string {
  const j2000Ms = Date.UTC(2000, 0, 1, 12, 0, 0);
  const d = new Date(j2000Ms + simDays * 86400000);
  const year = d.getUTCFullYear();
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${year} ${mon} ${day} · ${hh}:${mm}:${ss} UTC`;
}

export function getPlanetAndStarDetails(
  id: string | null,
  kind: 'celestial' | 'nearby-star' | null,
) {
  if (!id || !kind) return null;
  if (kind === 'celestial') return BODY_MAP.get(id) ?? null;
  return NEARBY_STAR_MAP.get(id) ?? null;
}
