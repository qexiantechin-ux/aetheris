import * as THREE from 'three';

const NOISE_GLSL = `
  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float noise3D(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(
        mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
        mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x),
        f.y
      ),
      mix(
        mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
        mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x),
        f.y
      ),
      f.z
    );
  }

  float fbm3D(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise3D(p);
      p = p * 2.05 + vec3(13.1, 7.7, 5.3);
      a *= 0.5;
    }
    return v;
  }
`;

export function createStellarSurfaceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uHotColor: { value: new THREE.Color(1.0, 0.97, 0.93) },
      uMidColor: { value: new THREE.Color(1.0, 0.95, 0.90) },
      uCoolColor: { value: new THREE.Color(0.86, 0.78, 0.70) },
      uUmbraColor: { value: new THREE.Color(0.36, 0.27, 0.19) },
      uLimbTint: { value: new THREE.Color(0.76, 0.67, 0.58) },
      uGranuleScale: { value: 6.2 },
      uSpotIntensity: { value: 0.48 },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vViewNormal;
      varying vec3 vObjPos;
      varying vec3 vViewPos;

      void main() {
        vObjPos = normalize(position);
        vViewNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mvPos.xyz;
        gl_Position = projectionMatrix * mvPos;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime;
      uniform vec3 uHotColor;
      uniform vec3 uMidColor;
      uniform vec3 uCoolColor;
      uniform vec3 uUmbraColor;
      uniform vec3 uLimbTint;
      uniform float uGranuleScale;
      uniform float uSpotIntensity;
      varying vec3 vViewNormal;
      varying vec3 vObjPos;
      varying vec3 vViewPos;
      ${NOISE_GLSL}

      void main() {
        #include <logdepthbuf_fragment>
        vec3 p = vObjPos * uGranuleScale;
        float t = uTime * 0.12;
        float n1 = fbm3D(p + vec3(t, -t * 0.5, t * 0.35));
        float n2 = fbm3D(p * 2.4 - vec3(t * 0.7, t * 0.45, -t * 0.6) + n1 * 1.4);
        float gran = smoothstep(0.22, 0.86, n2);
        float starspot = smoothstep(0.24, 0.13, n1);

        vec3 viewDir = normalize(-vViewPos);
        float ndv = max(dot(normalize(vViewNormal), viewDir), 0.0);
        float limb = pow(ndv, 0.58);

        vec3 col = mix(uCoolColor, uMidColor, gran);
        col = mix(col, uHotColor, smoothstep(0.58, 0.94, gran) * 0.90);
        col = mix(col, uUmbraColor, starspot * uSpotIntensity);
        col *= mix(uLimbTint, vec3(1.18, 1.18, 1.18), limb);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

export function createSunSurfaceMaterial(): THREE.ShaderMaterial {
  return createStellarSurfaceMaterial();
}

export function createStellarCoronaMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 1.0 },
      uInnerColor: { value: new THREE.Color(1.0, 0.97, 0.94) },
      uOuterColor: { value: new THREE.Color(0.96, 0.89, 0.82) },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vViewNormal;
      varying vec3 vViewPos;

      void main() {
        vViewNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mvPos.xyz;
        gl_Position = projectionMatrix * mvPos;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime;
      uniform float uOpacity;
      uniform vec3 uInnerColor;
      uniform vec3 uOuterColor;
      varying vec3 vViewNormal;
      varying vec3 vViewPos;

      void main() {
        #include <logdepthbuf_fragment>
        vec3 viewDir = normalize(-vViewPos);
        float rim = clamp(dot(-normalize(vViewNormal), viewDir), 0.0, 1.0);
        float innerGlow = pow(rim, 4.2) * 0.95;
        float outerGlow = pow(rim, 1.9) * 0.22;
        float glow = innerGlow + outerGlow;
        vec3 col = mix(uOuterColor, uInnerColor, pow(rim, 2.2));
        gl_FragColor = vec4(col * glow, glow * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });
}

export function createSunCoronaMaterial(): THREE.ShaderMaterial {
  return createStellarCoronaMaterial();
}

export interface AtmosphereShaderConfig {
  innerColor: string;
  outerColor: string;
  terminatorColor: string;
  planetRatio: number;
  falloff: number;
  haloStrength: number;
  veilStrength: number;
  forwardScatter: number;
}

function makeSrgbColor(hex: string): THREE.Color {
  const c = new THREE.Color(hex);
  c.getRGB(c, THREE.SRGBColorSpace);
  return c;
}

export function createAtmosphereMaterial(
  config: AtmosphereShaderConfig,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uInnerColor: { value: makeSrgbColor(config.innerColor) },
      uOuterColor: { value: makeSrgbColor(config.outerColor) },
      uTerminatorColor: { value: makeSrgbColor(config.terminatorColor) },
      uPlanetRatio: { value: config.planetRatio },
      uFalloff: { value: config.falloff },
      uHaloStrength: { value: config.haloStrength },
      uForwardScatter: { value: config.forwardScatter },
      uSunPosition: { value: new THREE.Vector3(0, 0, 0) },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vViewPos;
      varying vec3 vViewCenter;
      varying float vAtmoRadius;

      void main() {
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mvPos.xyz;
        vViewCenter = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vAtmoRadius = length((modelViewMatrix * vec4(position, 0.0)).xyz);
        gl_Position = projectionMatrix * mvPos;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uInnerColor;
      uniform vec3 uOuterColor;
      uniform vec3 uTerminatorColor;
      uniform float uPlanetRatio;
      uniform float uFalloff;
      uniform float uHaloStrength;
      uniform float uForwardScatter;
      uniform vec3 uSunPosition;
      varying vec3 vViewPos;
      varying vec3 vViewCenter;
      varying float vAtmoRadius;

      void main() {
        #include <logdepthbuf_fragment>
        vec3 rd = normalize(vViewPos);
        float t = dot(vViewCenter, rd);
        if (t <= 0.0) discard;

        vec3 closestVec = rd * t - vViewCenter;
        float rMinNorm = length(closestVec) / max(vAtmoRadius, 1e-7);
        if (rMinNorm < uPlanetRatio * 0.85) discard;
        float h = clamp((rMinNorm - uPlanetRatio) / max(1.0 - uPlanetRatio, 0.001), 0.0, 1.0);
        if (h >= 0.995) discard;

        // Exponential atmospheric scale height decaying completely to zero before outer mesh edge
        float outerFade = 1.0 - smoothstep(0.55, 0.995, h);
        float density = (exp(-h * uFalloff) * 0.86 + exp(-h * 2.1) * 0.16) * outerFade;

        vec3 limbDir = normalize(closestVec);
        vec3 sunViewPos = (viewMatrix * vec4(uSunPosition, 1.0)).xyz;
        vec3 sunDir = normalize(sunViewPos - vViewCenter);
        float sunDot = dot(limbDir, sunDir);

        // Day limb illumination + Mie forward-scattering wrap on backlit crescents
        float dayIllum = smoothstep(-0.16, 0.38, sunDot);
        float forwardCos = max(dot(rd, sunDir), 0.0);
        float mieForward = pow(forwardCos, 4.5) * smoothstep(-0.42, 0.14, sunDot) * uForwardScatter;
        float lightFactor = clamp(dayIllum + mieForward * (1.0 - h * 0.35), 0.0, 1.45);

        // Sunset/twilight grazing color shift near terminator + Rayleigh altitude shift
        float twilight = exp(-pow((sunDot + 0.02) * 5.8, 2.0)) * (1.0 - h * 0.55);
        vec3 rayleighCol = mix(uInnerColor, uOuterColor, smoothstep(0.05, 0.65, h));
        vec3 scatterCol = mix(rayleighCol, uTerminatorColor, clamp(twilight * 0.65, 0.0, 0.72));
        scatterCol = mix(scatterCol, vec3(1.0), clamp(mieForward * 0.28 * (1.0 - h), 0.0, 0.35));
        scatterCol *= 1.0 + (1.0 - h) * 0.36;

        float alpha = clamp(density * uHaloStrength * lightFactor, 0.0, 1.0);
        if (alpha <= 0.002) discard;

        gl_FragColor = vec4(scatterCol, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });
}

export function createAtmosphereVeilMaterial(
  config: AtmosphereShaderConfig,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uInnerColor: { value: makeSrgbColor(config.innerColor) },
      uOuterColor: { value: makeSrgbColor(config.outerColor) },
      uTerminatorColor: { value: makeSrgbColor(config.terminatorColor) },
      uVeilStrength: { value: config.veilStrength },
      uSunPosition: { value: new THREE.Vector3(0, 0, 0) },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vViewNormal;
      varying vec3 vViewPos;

      void main() {
        vViewNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mvPos.xyz;
        gl_Position = projectionMatrix * mvPos;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uInnerColor;
      uniform vec3 uOuterColor;
      uniform vec3 uTerminatorColor;
      uniform float uVeilStrength;
      uniform vec3 uSunPosition;
      varying vec3 vViewNormal;
      varying vec3 vViewPos;

      void main() {
        #include <logdepthbuf_fragment>
        vec3 viewDir = normalize(-vViewPos);
        vec3 n = normalize(vViewNormal);
        float ndv = max(dot(n, viewDir), 0.0);

        // Smooth airmass scattering that peaks near the planet horizon and hands off cleanly to outer halo
        float airmass = pow(1.0 - ndv, 1.85);
        float rimHandoff = smoothstep(0.0, 0.13, ndv);
        float scatterWeight = (0.06 + airmass * 0.94) * rimHandoff;

        vec3 sunViewPos = (viewMatrix * vec4(uSunPosition, 1.0)).xyz;
        vec3 sunDir = normalize(sunViewPos - vViewPos);
        float sunDot = dot(n, sunDir);

        float dayFactor = smoothstep(-0.12, 0.40, sunDot);
        float twilight = exp(-pow((sunDot + 0.02) * 6.5, 2.0)) * smoothstep(-0.16, 0.05, sunDot);

        vec3 baseScatter = mix(uOuterColor, uInnerColor, pow(1.0 - ndv, 1.55) * 0.72);
        vec3 scatterCol = mix(baseScatter, uTerminatorColor, clamp(twilight * 0.62, 0.0, 0.7));
        scatterCol *= 1.0 + airmass * 0.24;

        float alpha = clamp(scatterWeight * uVeilStrength * dayFactor, 0.0, 0.88);
        if (alpha <= 0.002) discard;

        gl_FragColor = vec4(scatterCol, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
  });
}

export function createMilkyWaySkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBrightness: { value: 1.0 },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vDir;

      void main() {
        vDir = normalize(position);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uBrightness;
      varying vec3 vDir;
      ${NOISE_GLSL}

      void main() {
        #include <logdepthbuf_fragment>
        // Tilt galactic plane ~60 degrees relative to ecliptic
        vec3 gp = normalize(vec3(
          vDir.x * 0.86 - vDir.y * 0.51,
          vDir.x * 0.51 + vDir.y * 0.86,
          vDir.z
        ));
        float plane = exp(-pow(abs(gp.y) * 4.8, 1.55));
        float coreDir = max(dot(gp, normalize(vec3(0.45, 0.0, -0.89))), 0.0);
        float core = pow(coreDir, 3.2);

        float cloud = fbm3D(gp * 5.2);
        float dust = smoothstep(0.35, 0.66, fbm3D(gp * 11.5 + vec3(2.4)));

        vec3 baseSpace = vec3(0.004, 0.006, 0.011);
        vec3 bandColor = mix(vec3(0.055, 0.085, 0.165), vec3(0.21, 0.16, 0.13), core);
        float bandIntensity = plane * (0.28 + cloud * 0.72) * (1.0 - dust * 0.65);
        bandIntensity += core * plane * 0.34;

        vec3 col = baseSpace + bandColor * bandIntensity * uBrightness;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

export function bakeMilkyWaySkyMaterial(
  renderer: THREE.WebGLRenderer,
  sourceMat: THREE.ShaderMaterial,
): { material: THREE.ShaderMaterial; cubeTarget: THREE.WebGLCubeRenderTarget } | null {
  if (!renderer.capabilities.isWebGL2) return null;
  const gl = renderer.getContext();
  const canRenderHalfFloat =
    Boolean(gl.getExtension('EXT_color_buffer_float')) ||
    Boolean(gl.getExtension('EXT_color_buffer_half_float'));
  if (!canRenderHalfFloat) return null;

  const cubeTarget = new THREE.WebGLCubeRenderTarget(1024, {
    type: THREE.HalfFloatType,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });

  const bakeScene = new THREE.Scene();
  const bakeGeo = new THREE.SphereGeometry(5, 32, 24);
  const bakeMesh = new THREE.Mesh(bakeGeo, sourceMat);
  bakeScene.add(bakeMesh);

  const cubeCam = new THREE.CubeCamera(0.1, 20, cubeTarget);
  const prevToneMapping = renderer.toneMapping;
  const prevRenderTarget = renderer.getRenderTarget();

  renderer.toneMapping = THREE.NoToneMapping;
  cubeCam.update(renderer, bakeScene);
  renderer.toneMapping = prevToneMapping;
  renderer.setRenderTarget(prevRenderTarget);

  bakeGeo.dispose();

  const bakedMat = new THREE.ShaderMaterial({
    uniforms: {
      uSkyCube: { value: cubeTarget.texture },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vDir;

      void main() {
        vDir = normalize(position);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform samplerCube uSkyCube;
      varying vec3 vDir;

      void main() {
        #include <logdepthbuf_fragment>
        gl_FragColor = textureCube(uSkyCube, normalize(vDir));
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });

  return { material: bakedMat, cubeTarget };
}

export function createNearbyStarPointMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: 1.0 },
      uBoost: { value: 1.0 },
      uParsecUnits: { value: 66004789.0 },
      uFocusedStarIndex: { value: -1.0 },
      uFocusedPointAlpha: { value: 1.0 },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float aAbsMag;
      attribute vec3 aColor;
      attribute float aStarIndex;
      uniform float uPixelRatio;
      uniform float uBoost;
      uniform float uParsecUnits;
      uniform float uFocusedStarIndex;
      uniform float uFocusedPointAlpha;
      varying vec3 vColor;
      varying float vAlphaScale;

      void main() {
        vColor = aColor;
        float focusMask = (abs(aStarIndex - uFocusedStarIndex) < 0.25) ? uFocusedPointAlpha : 1.0;

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float distUnits = max(length(mvPosition.xyz), 1.0);
        float distPc = max(distUnits / max(uParsecUnits, 1.0), 0.0001);
        float appMag = aAbsMag + 5.0 * (log(distPc) * 0.4342944819 - 1.0);

        float brightNorm = clamp((5.6 - appMag) / 7.2, 0.0, 1.35);
        float magScale = mix(0.20, 1.0, smoothstep(8.5, 1.4, appMag));
        vAlphaScale = focusMask * magScale;

        float basePx = 1.6 + pow(max(brightNorm, 0.0001), 1.15) * 10.5;
        gl_PointSize = clamp(basePx * uBoost * uPixelRatio, 1.8, 28.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec3 vColor;
      varying float vAlphaScale;

      void main() {
        #include <logdepthbuf_fragment>
        if (vAlphaScale <= 0.005) discard;
        vec2 uv = 2.0 * gl_PointCoord - 1.0;
        float r = length(uv);
        if (r > 1.0) discard;
        float core = exp(-r * r * 15.0);
        float halo = exp(-r * 3.8) * 0.50;
        float spike = (exp(-abs(uv.x) * 18.0) * exp(-abs(uv.y) * 2.6) +
                       exp(-abs(uv.y) * 18.0) * exp(-abs(uv.x) * 2.6)) * 0.22;
        float alpha = clamp(core + halo + spike, 0.0, 1.0) * vAlphaScale;
        vec3 col = mix(vColor, vec3(1.0), core * 0.36);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function createLensFlareMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunScreen: { value: new THREE.Vector2(0.5, 0.5) },
      uAspect: { value: 1.777 },
      uIntensity: { value: 0.0 },
      uSize: { value: 1.0 },
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec2 uSunScreen;
      uniform float uAspect;
      uniform float uIntensity;
      uniform float uSize;
      varying vec2 vUv;

      float hexDist(vec2 p) {
        p = abs(p);
        return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
      }

      float hexGhost(vec2 p, vec2 center, float radius, float soft) {
        float hd = hexDist(p - center);
        float fill = 1.0 - smoothstep(radius - soft, radius + soft, hd);
        float rim = exp(-pow((hd - radius * 0.88) / max(soft * 0.65, 0.0005), 2.0)) * 0.45;
        return fill * 0.36 + rim;
      }

      void main() {
        if (uIntensity <= 0.001 || uSize <= 0.001) discard;

        float s = max(uSize, 0.02);
        vec2 sunP = (uSunScreen - 0.5) * vec2(uAspect, 1.0);
        vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
        float dist = length(p - sunP);

        // Compact chromatic iris ring behind emitter
        float ringDist = abs(dist - 0.14 * s);
        float haloRing = exp(-ringDist * ringDist * (3200.0 / (s * s))) * 0.055;
        vec3 ringTint = mix(vec3(0.38, 0.75, 1.0), vec3(1.0, 0.68, 0.38), clamp((dist - 0.11 * s) * (18.0 / s), 0.0, 1.0));
        vec3 col = ringTint * haloRing;

        // Compact hexagonal aperture flare ghosts along the optical axis
        float sunEcc = smoothstep(0.02, 0.22, length(sunP));
        vec3 ghosts = vec3(0.0);
        ghosts += hexGhost(p, sunP * 0.44, 0.020 * s, 0.005 * s) * vec3(1.0, 0.78, 0.42) * 0.095;
        ghosts += hexGhost(p, -sunP * 0.30, 0.032 * s, 0.008 * s) * vec3(0.35, 0.82, 1.0) * 0.085;
        ghosts += hexGhost(p, -sunP * 0.62, 0.016 * s, 0.004 * s) * vec3(0.45, 0.94, 0.80) * 0.11;
        ghosts += hexGhost(p, -sunP * 0.96, 0.044 * s, 0.012 * s) * vec3(0.42, 0.54, 1.0) * 0.065;
        ghosts += hexGhost(p, -sunP * 1.32, 0.024 * s, 0.006 * s) * vec3(1.0, 0.56, 0.36) * 0.075;
        col += ghosts * sunEcc;

        gl_FragColor = vec4(col * uIntensity, 1.0);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function createBodyFlareMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec3 aFlareColor;
      attribute float aFlareIntensity;
      attribute float aStreakWeight;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vIntensity;
      varying float vStreak;

      void main() {
        vUv = uv;
        vColor = aFlareColor;
        vIntensity = aFlareIntensity;
        vStreak = aStreakWeight;
        vec4 mvPosition = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vIntensity;
      varying float vStreak;

      void main() {
        #include <logdepthbuf_fragment>
        if (vIntensity <= 0.001) discard;

        vec2 p = (vUv - 0.5) * 2.0;
        float dist = length(p);
        if (dist >= 1.0) discard;

        float edge = smoothstep(1.0, 0.32, dist);

        // Soft Mie optical glare behind the emitting body
        float glow = (exp(-dist * 7.8) * 0.58 + exp(-dist * 3.4) * 0.22) * edge;

        // Crisp 6-point diffraction starburst spikes
        float ang = atan(p.y, p.x) + uTime * 0.01;
        float primaryRays = pow(abs(cos(ang * 3.0)), 34.0) * 0.48;
        float secondaryRays = pow(abs(cos(ang * 2.0 + 0.7854)), 46.0) * 0.22;
        float rays = (primaryRays + secondaryRays) * exp(-dist * 4.0) * edge;

        // Subtle horizontal anamorphic optical streak
        float streak = exp(-abs(p.y) * 44.0) * exp(-abs(p.x) * 2.8) * smoothstep(1.0, 0.38, abs(p.x)) * 0.45 * vStreak;
        vec3 streakTint = mix(vColor, vec3(0.45, 0.82, 1.0), smoothstep(0.08, 0.55, abs(p.x)));

        vec3 col = vColor * (glow + rays) + streakTint * streak;
        gl_FragColor = vec4(col * vIntensity, 1.0);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function createFocusedStarFlareMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uColor: { value: new THREE.Color(1.0, 0.96, 0.91) },
      uIntensity: { value: 0.0 },
      uStreak: { value: 0.7 },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;

      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uStreak;
      varying vec2 vUv;

      void main() {
        #include <logdepthbuf_fragment>
        if (uIntensity <= 0.001) discard;

        vec2 p = (vUv - 0.5) * 2.0;
        float dist = length(p);
        if (dist >= 1.0) discard;

        float edge = smoothstep(1.0, 0.32, dist);
        float glow = (exp(-dist * 7.8) * 0.58 + exp(-dist * 3.4) * 0.22) * edge;

        float ang = atan(p.y, p.x) + uTime * 0.01;
        float primaryRays = pow(abs(cos(ang * 3.0)), 34.0) * 0.48;
        float secondaryRays = pow(abs(cos(ang * 2.0 + 0.7854)), 46.0) * 0.22;
        float rays = (primaryRays + secondaryRays) * exp(-dist * 4.0) * edge;

        float streak = exp(-abs(p.y) * 44.0) * exp(-abs(p.x) * 2.8) * smoothstep(1.0, 0.38, abs(p.x)) * 0.45 * uStreak;
        vec3 streakTint = mix(uColor, vec3(0.45, 0.82, 1.0), smoothstep(0.08, 0.55, abs(p.x)));

        vec3 col = uColor * (glow + rays) + streakTint * streak;
        gl_FragColor = vec4(col * uIntensity, 1.0);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function splitFloat48Into(
  x: number,
  out0: ArrayLike<number> & Record<number, number>,
  out1: ArrayLike<number> & Record<number, number>,
  out2: ArrayLike<number> & Record<number, number>,
  idx: number,
): void {
  if (x === 0) {
    out0[idx] = 0;
    out1[idx] = 0;
    out2[idx] = 0;
    return;
  }
  const x32a = Math.fround(x);
  const c0 = Math.fround(4097 * x32a);
  const x0 = Math.fround(c0 - Math.fround(c0 - x32a));
  const rem1 = x - x0;
  const x32b = Math.fround(rem1);
  const c1 = Math.fround(4097 * x32b);
  const x1 = Math.fround(c1 - Math.fround(c1 - x32b));
  const x2 = Math.fround(rem1 - x1);
  out0[idx] = x0;
  out1[idx] = x1;
  out2[idx] = x2;
}

export function encodeRteFloat64Positions(
  coords: ArrayLike<number>,
  pos0: Float32Array,
  pos1: Float32Array,
  pos2: Float32Array,
): void {
  for (let i = 0; i < coords.length; i++) {
    splitFloat48Into(coords[i], pos0, pos1, pos2, i);
  }
}

export function createRteLineGeometry(coords: number[]): THREE.BufferGeometry {
  const pos0 = new Float32Array(coords.length);
  const pos1 = new Float32Array(coords.length);
  const pos2 = new Float32Array(coords.length);
  encodeRteFloat64Positions(coords, pos0, pos1, pos2);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos0, 3));
  geo.setAttribute('aPosMid', new THREE.BufferAttribute(pos1, 3));
  geo.setAttribute('aPosLow', new THREE.BufferAttribute(pos2, 3));
  return geo;
}

export function createPrecisionLineMaterial(
  colorHex: string,
  opacity = 0.34,
): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uOpacity: { value: opacity },
      uRot0: { value: new THREE.Matrix3() },
      uRot1: { value: new THREE.Matrix3() },
      uRot2: { value: new THREE.Matrix3() },
      uTransHigh: { value: new THREE.Vector3() },
      uTransLow: { value: new THREE.Vector3() },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec3 aPosMid;
      attribute vec3 aPosLow;
      uniform mat3 uRot0;
      uniform mat3 uRot1;
      uniform mat3 uRot2;
      uniform vec3 uTransHigh;
      uniform vec3 uTransLow;

      vec2 ds_twoSum(float a, float b) {
        float s = a + b;
        float v = s - a;
        float e = (a - (s - v)) + (b - v);
        return vec2(s, e);
      }

      vec2 ds_add(vec2 a, vec2 b) {
        vec2 s = ds_twoSum(a.x, b.x);
        vec2 t = ds_twoSum(a.y, b.y);
        s.y += t.x;
        s = ds_twoSum(s.x, s.y);
        s.y += t.y;
        return ds_twoSum(s.x, s.y);
      }

      // 12+12+24 bit split factors make r0*p0, r0*p1, r1*p0 exact in binary32 (immune to GPU FMA)
      vec2 ds_mul48(float r0, float r1, float r2, float p0, float p1, float p2) {
        vec2 ab = ds_twoSum(r0 * p0, r0 * p1);
        ab = ds_add(ab, vec2(r1 * p0, r0 * p2 + r1 * p1 + r2 * p0));
        return ds_add(ab, vec2(r1 * p2 + r2 * p1, 0.0));
      }

      void main() {
        vec2 vx = ds_add(
          ds_add(
            ds_mul48(uRot0[0][0], uRot1[0][0], uRot2[0][0], position.x, aPosMid.x, aPosLow.x),
            ds_mul48(uRot0[1][0], uRot1[1][0], uRot2[1][0], position.y, aPosMid.y, aPosLow.y)
          ),
          ds_add(
            ds_mul48(uRot0[2][0], uRot1[2][0], uRot2[2][0], position.z, aPosMid.z, aPosLow.z),
            vec2(uTransHigh.x, uTransLow.x)
          )
        );
        vec2 vy = ds_add(
          ds_add(
            ds_mul48(uRot0[0][1], uRot1[0][1], uRot2[0][1], position.x, aPosMid.x, aPosLow.x),
            ds_mul48(uRot0[1][1], uRot1[1][1], uRot2[1][1], position.y, aPosMid.y, aPosLow.y)
          ),
          ds_add(
            ds_mul48(uRot0[2][1], uRot1[2][1], uRot2[2][1], position.z, aPosMid.z, aPosLow.z),
            vec2(uTransHigh.y, uTransLow.y)
          )
        );
        vec2 vz = ds_add(
          ds_add(
            ds_mul48(uRot0[0][2], uRot1[0][2], uRot2[0][2], position.x, aPosMid.x, aPosLow.x),
            ds_mul48(uRot0[1][2], uRot1[1][2], uRot2[1][2], position.y, aPosMid.y, aPosLow.y)
          ),
          ds_add(
            ds_mul48(uRot0[2][2], uRot1[2][2], uRot2[2][2], position.z, aPosMid.z, aPosLow.z),
            vec2(uTransHigh.z, uTransLow.z)
          )
        );

        vec3 mvPos = vec3(vx.x + vx.y, vy.x + vy.y, vz.x + vz.y);
        gl_Position = projectionMatrix * vec4(mvPos, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      uniform float uOpacity;

      void main() {
        #include <logdepthbuf_fragment>
        if (uOpacity <= 0.001) discard;
        gl_FragColor = vec4(uColor, uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  mat.opacity = opacity;
  return mat;
}

let _cachedRteFrame = -1;
let _cachedRteCam: THREE.Camera | null = null;
const _cachedViewRot0 = new Float32Array(9);
const _cachedViewRot1 = new Float32Array(9);
const _cachedViewRot2 = new Float32Array(9);

export function attachRteLineBeforeRender(line: THREE.Line): void {
  line.frustumCulled = false;
  line.onBeforeRender = (renderer, _scene, camera) => {
    const mat = line.material as THREE.ShaderMaterial;
    const u = mat.uniforms;
    u.uOpacity.value = mat.opacity;

    const me = line.matrixWorld.elements;
    const ce = camera.matrixWorld.elements;
    const ve = camera.matrixWorldInverse.elements;

    const dx = me[12] - ce[12];
    const dy = me[13] - ce[13];
    const dz = me[14] - ce[14];

    const tx = ve[0] * dx + ve[4] * dy + ve[8] * dz;
    const ty = ve[1] * dx + ve[5] * dy + ve[9] * dz;
    const tz = ve[2] * dx + ve[6] * dy + ve[10] * dz;

    const thx = Math.fround(tx);
    const thy = Math.fround(ty);
    const thz = Math.fround(tz);
    (u.uTransHigh.value as THREE.Vector3).set(thx, thy, thz);
    (u.uTransLow.value as THREE.Vector3).set(
      Math.fround(tx - thx),
      Math.fround(ty - thy),
      Math.fround(tz - thz),
    );

    const frame = renderer.info.render.frame;
    if (_cachedRteFrame !== frame || _cachedRteCam !== camera) {
      _cachedRteFrame = frame;
      _cachedRteCam = camera;
      for (let col = 0; col < 3; col++) {
        for (let row = 0; row < 3; row++) {
          splitFloat48Into(
            ve[col * 4 + row],
            _cachedViewRot0,
            _cachedViewRot1,
            _cachedViewRot2,
            col * 3 + row,
          );
        }
      }
    }

    const r0 = (u.uRot0.value as THREE.Matrix3).elements;
    const r1 = (u.uRot1.value as THREE.Matrix3).elements;
    const r2 = (u.uRot2.value as THREE.Matrix3).elements;

    // Fast path for unrotated/unscaled lines (planets, dwarfs, constellations): R_view * I === R_view
    if (
      me[0] === 1 &&
      me[5] === 1 &&
      me[10] === 1 &&
      me[1] === 0 &&
      me[2] === 0 &&
      me[4] === 0 &&
      me[6] === 0 &&
      me[8] === 0 &&
      me[9] === 0
    ) {
      for (let k = 0; k < 9; k++) {
        r0[k] = _cachedViewRot0[k];
        r1[k] = _cachedViewRot1[k];
        r2[k] = _cachedViewRot2[k];
      }
      return;
    }

    for (let col = 0; col < 3; col++) {
      const m0 = me[col * 4];
      const m1 = me[col * 4 + 1];
      const m2 = me[col * 4 + 2];
      for (let row = 0; row < 3; row++) {
        const val = ve[row] * m0 + ve[4 + row] * m1 + ve[8 + row] * m2;
        splitFloat48Into(val, r0, r1, r2, col * 3 + row);
      }
    }
  };
}
