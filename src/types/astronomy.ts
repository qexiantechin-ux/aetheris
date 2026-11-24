export type BodyCategory = 'star' | 'planet' | 'dwarf' | 'moon';

export type ScaleMode = 'balanced' | 'true';

export type CameraRegime = 'planet' | 'solar' | 'interstellar';

export interface PlanetVisualRecipe {
  kind:
    | 'sun'
    | 'mercury'
    | 'venus'
    | 'earth'
    | 'mars'
    | 'jupiter'
    | 'saturn'
    | 'uranus'
    | 'neptune'
    | 'pluto'
    | 'moon'
    | 'rocky_moon'
    | 'icy_moon'
    | 'volcanic_moon'
    | 'hazy_moon';
  textureUrl?: string;
  cloudTextureUrl?: string;
  nightTextureUrl?: string;
  heightTextureUrl?: string;
  seed: number;
  baseColor: string;
  secondaryColor: string;
  accentColor?: string;
  atmosphereColor?: string;
  atmosphereIntensity?: number;
  hasClouds?: boolean;
  cloudColor?: string;
  cloudOpacity?: number;
  hasNightLights?: boolean;
  rings?: {
    innerFactor: number;
    outerFactor: number;
    colorA: string;
    colorB: string;
    opacity: number;
  };
  roughness: number;
  metalness: number;
}

export interface CelestialBodyData {
  id: string;
  name: string;
  category: BodyCategory;
  isDwarfCandidate?: boolean;
  classification: string;
  parentId: string | null;
  orbitInParentEquator?: boolean;
  // Balanced scale parameters (scene units)
  balancedRadius: number;
  balancedOrbitRadius: number;
  // True proportional scale parameters (scene units, scaled to 1 AU = 320 units)
  trueRadius: number;
  trueOrbitRadius: number;
  // Orbital mechanics
  eccentricity: number;
  inclinationDeg: number;
  axialTiltDeg: number;
  orbitalPeriodDays: number;
  rotationPeriodHours: number; // negative = retrograde
  initialAngleRad: number;
  orbitColor: string;
  absMag: number; // IAU H magnitude (or solar M_V for Sun)
  // Scientific telemetry for dossier
  telemetry: {
    radiusKm: string;
    massEarth: string;
    gravityMs2: string;
    meanTempC: string;
    distanceLabel: string;
    orbitalPeriodLabel: string;
    dayLengthLabel: string;
    atmosphereSummary: string;
    moonsCount?: number;
  };
  summary: string;
  highlights: string[];
  visual: PlanetVisualRecipe;
}

export interface StarComponentData {
  id: string;
  name: string;
  roleLabel?: string; // e.g. 'Primary', 'White Dwarf', 'Secondary'
  spectralClass: string;
  temperatureK: number;
  luminositySolar: number;
  massSolar: number;
  radiusSolar?: number; // exact radius when known (white dwarfs, supergiants)
  parentId: string | null; // null = system barycenter; or id of parent sub-barycenter
  isVirtualBarycenter?: boolean; // true for massless barycentric pair nodes
  semiMajorAu: number;
  eccentricity: number;
  inclinationDeg: number;
  argPeriapsisDeg: number;
  orbitalPeriodDays: number;
  initialAngleRad: number;
  orbitColor: string;
}

export interface NearbyStarData {
  id: string;
  name: string;
  designation: string;
  spectralClass: string;
  spectralGroup: 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M';
  color: string;
  raHours: number;
  decDeg: number;
  distanceLy: number;
  apparentMag: number;
  absoluteMag: number;
  luminositySolar: string;
  temperatureK: number;
  constellation: string;
  exoplanetsCount: number;
  summary: string;
  highlights: string[];
  components?: StarComponentData[];
  /** Ideal primary-system framing span in AU when flying to the multi-star overview */
  overviewSpanAu?: number;
}

export interface ConstellationData {
  id: string;
  name: string;
  abbreviation: string;
  // Pairs of real catalog star IDs connected in 3D space
  starPairs: Array<[string, string]>;
  centerRaHours: number;
  centerDecDeg: number;
}

export interface LayerVisibility {
  orbits: boolean;
  dwarfOrbits: boolean;
  labels: boolean;
  constellations: boolean;
  asteroids: boolean;
}

export interface PlanetariumSettings {
  quality: number;
  lensFlareSize: number;
  lensFlareStrength: number;
  showSkybox: boolean;
}

export interface TimeSpeedOption {
  id: string;
  label: string;
  daysPerSecond: number;
}

export interface SearchableTarget {
  id: string;
  componentId?: string;
  name: string;
  subtitle: string;
  kind: 'celestial' | 'nearby-star';
  categoryLabel: string;
  accentColor: string;
}

export interface MarkerProjection {
  id: string;
  name: string;
  subtitle: string;
  kind: 'celestial' | 'nearby-star';
  componentId?: string;
  x: number;
  y: number;
  visible: boolean;
  opacity: number;
  color: string;
  isSelected: boolean;
}
