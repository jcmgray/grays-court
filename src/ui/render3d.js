// 3d renderer: the board as a little diorama of land floating over the page,
// with hedgerows between the regions, farms and stone castles, lit by the
// sun or moon for the time of day. it takes the same model as the svg
// renderer in render.js, plus hour, the time of day to light it for

import * as THREE from "three";
import { CASTLE, ROAD } from "../core/rules.js";
import { hashString, makeRng } from "../core/rng.js";
import { mixColour } from "./colour.js";
import { regionPath, riverEdges } from "./render.js";
import { STONES, TREES } from "./themes.js";

// how long a new piece takes to grow in, and the pause between pieces that
// appear together
const GROW_MS = 450;
const CELL_STAGGER = 15;

// ms before a new rule break shows in red
const BREAK_DELAY = 600;

// heights of the tiles' tops, and of overlays floating just above things
const TOP = 0.1;
const OVERLAY = 0.5;

const SOIL = "#6b5434";
const HEDGE = ["#3f5a2c", "#4a6632", "#36502a"];
// water at its edges and down its middle, and its banks on top and where
// they meet the water
const WATER = ["#5585b8", "#2e5d94"];
const BANK = ["#7a7450", "#4f4832"];
const ROAD_COLOUR = "#9b8257";
const FLAGS = ["#b3322d", "#2d5fb3", "#e0b13a", "#2f7d4a"];
const WALLS = ["#e6dcc6", "#d8c9a6", "#c9b48e", "#b8ad98"];
const THATCH = ["#b0904f", "#9a7a42", "#8f6d3a", "#9a5a3c"];

// the light through the day: hour, sun colour and strength, sky and ground
// colours and strength for the soft fill light, and how much it counts as
// night, which turns on the windows
const DAY = [
  [0, "#a6b8f0", 1, "#4a5a8f", "#1a1f2c", 0.8, 1],
  [5, "#ffa58a", 1, "#7a7aa8", "#2a2620", 0.75, 0.7],
  [7, "#ffd29a", 1.8, "#bcd3ea", "#5a5040", 0.85, 0],
  [12, "#fff6e8", 2.6, "#d8ebff", "#6b6250", 1, 0],
  [17, "#ffcf8a", 2.2, "#cfdcec", "#6b5a40", 0.9, 0],
  [19, "#ff8a4a", 1.3, "#a08aa8", "#4a3a30", 0.75, 0.5],
  [21, "#a6b8f0", 1, "#4a5a8f", "#1a1f2c", 0.8, 1],
  [24, "#a6b8f0", 1, "#4a5a8f", "#1a1f2c", 0.8, 1],
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// small mostly white textures with faint darker and lighter marks, that tint
// a colour into a pattern. each draws on a 128 pixel square canvas
const PATTERN = 128;

function patternTexture(seed, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PATTERN;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PATTERN, PATTERN);
  draw(ctx, makeRng(seed));
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// little ripples on the water as a normal map, so it catches the light
// unevenly. a sum of waves that each fit a whole number of times across, so
// the texture tiles without seams
function rippleTexture(seed, size = 128) {
  const rng = makeRng(seed);
  const waves = Array.from({ length: 6 }, () => ({
    kx: Math.floor(rng() * 9) - 4,
    ky: 1 + Math.floor(rng() * 6),
    a: 0.6 + rng() * 0.6,
    phase: rng() * 2 * Math.PI,
  }));
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // the slope of the surface, from adding up each wave's
      let [sx, sy] = [0, 0];
      for (const { kx, ky, a, phase } of waves) {
        const slope = a * Math.cos((2 * Math.PI * (kx * x + ky * y)) / size + phase);
        sx += slope * kx;
        sy += slope * ky;
      }
      const [nx, ny] = [-sx * 0.08, -sy * 0.08];
      const len = Math.hypot(nx, ny, 1);
      const k = 4 * (y * size + x);
      data.set([(nx / len + 1) * 127.5, (ny / len + 1) * 127.5, (1 / len + 1) * 127.5, 255], k);
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// a rough dirt surface as a normal map: lots of little bumps and dips, each
// wrapping round the edges so the texture tiles without seams
function dirtTexture(seed, size = 64) {
  const rng = makeRng(seed);
  const height = new Float32Array(size * size);
  const wrap = (v) => (v + size) % size;
  for (let k = 0; k < 160; k++) {
    const [cx, cy] = [rng() * size, rng() * size];
    const r = 1 + rng() * 2.5;
    const a = (rng() - 0.4) * 2;
    for (let dy = -Math.ceil(3 * r); dy <= 3 * r; dy++) {
      for (let dx = -Math.ceil(3 * r); dx <= 3 * r; dx++) {
        const [x, y] = [wrap(Math.floor(cx) + dx), wrap(Math.floor(cy) + dy)];
        height[y * size + x] += a * Math.exp(-(dx * dx + dy * dy) / (r * r));
      }
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (i, j) => height[wrap(j) * size + wrap(i)];
      const [nx, ny] = [-(at(x + 1, y) - at(x - 1, y)) * 0.6, -(at(x, y + 1) - at(x, y - 1)) * 0.6];
      const len = Math.hypot(nx, ny, 1);
      data.set([(nx / len + 1) * 127.5, (ny / len + 1) * 127.5, (1 / len + 1) * 127.5, 255], 4 * (y * size + x));
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// roof tiles: rows of tiles each lapping over the row below, with the joins
// between tiles staggered from row to row. gives a normal map for their
// shape, and a shade to darken the top of each row, under the row above,
// and the joins
function tileTextures(size = 64, rows = 4, cols = 4) {
  const [rh, cw] = [size / rows, size / cols];
  const height = new Float32Array(size * size);
  const shade = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / rh);
    for (let x = 0; x < size; x++) {
      const join = (x + (row % 2) * (cw / 2)) % cw < 1.5;
      const t = (y % rh) / rh;
      height[y * size + x] = t - (join ? 0.6 : 0);
      const v = 255 * (join ? 0.62 : 0.7 + 0.3 * t);
      shade.set([v, v, v, 255], 4 * (y * size + x));
    }
  }
  const wrap = (v) => (v + size) % size;
  const at = (i, j) => height[wrap(j) * size + wrap(i)];
  const normal = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [nx, ny] = [-(at(x + 1, y) - at(x - 1, y)) * 1.5, -(at(x, y + 1) - at(x, y - 1)) * 1.5];
      const len = Math.hypot(nx, ny, 1);
      normal.set([(nx / len + 1) * 127.5, (ny / len + 1) * 127.5, (1 / len + 1) * 127.5, 255], 4 * (y * size + x));
    }
  }
  return [normal, shade].map((data, k) => {
    const tex = new THREE.DataTexture(data, size, size);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    if (k === 1) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  });
}

const dark = (rng, a) => `rgba(40, 50, 20, ${(a * (0.6 + 0.8 * rng())).toFixed(3)})`;
const light = (rng, a) => `rgba(255, 255, 230, ${(a * (0.6 + 0.8 * rng())).toFixed(3)})`;

// ploughed soil: bands running along the rows, with a little grit
function drawFurrows(ctx, rng) {
  for (let y = 0; y < PATTERN; y += 8) {
    ctx.fillStyle = dark(rng, 0.16);
    ctx.fillRect(0, y, PATTERN, 3);
    ctx.fillStyle = light(rng, 0.12);
    ctx.fillRect(0, y + 4, PATTERN, 2);
  }
  for (let k = 0; k < 500; k++) {
    ctx.fillStyle = rng() < 0.5 ? dark(rng, 0.14) : light(rng, 0.14);
    ctx.fillRect(rng() * PATTERN, rng() * PATTERN, 1, 1);
  }
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// overshoots a little then settles, for things growing in
const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

// the light for an hour from 0 to 24, blending between the DAY keys
function lightAt(hour) {
  const h = ((hour % 24) + 24) % 24;
  const k = DAY.findIndex((key) => key[0] > h);
  const [a, b] = [DAY[k - 1], DAY[k]];
  const t = (h - a[0]) / (b[0] - a[0]);
  const mix = (i) => (typeof a[i] === "string" ? mixColour(a[i], b[i], t) : a[i] + (b[i] - a[i]) * t);
  return { sun: mix(1), sunStrength: mix(2), sky: mix(3), ground: mix(4), fill: mix(5), night: mix(6), hour: h };
}

export function createRenderer3d(container) {
  const gl = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFSoftShadowMap;
  container.append(gl.domElement);

  const scene = new THREE.Scene();
  // circling the board's centre at yaw radians, 0 being from the south,
  // tilted tilt radians from straight down, and zoom times as far as the
  // board needs to fit
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  const TILT = [THREE.MathUtils.degToRad(8), THREE.MathUtils.degToRad(62)];
  const ZOOM = [0.55, 1.5];
  let tilt = THREE.MathUtils.degToRad(30);
  let zoom = 1;
  let yaw = 0;
  const distance = () => {
    // seen corner on, the board is wider, so step back to keep it all in
    const turned = Math.abs(Math.sin(yaw)) + Math.abs(Math.cos(yaw)) - 1;
    return zoom * 26 * (1 + turned * 0.75);
  };
  const placeCamera = () => {
    const [sx, cz] = [Math.sin(yaw), Math.cos(yaw)];
    const d = distance();
    camera.position.set(d * Math.sin(tilt) * sx, d * Math.cos(tilt), d * Math.sin(tilt) * cz);
    camera.lookAt(0.5 * sx, 0, 0.5 * cz);
  };
  placeCamera();

  const fill = new THREE.HemisphereLight("#d8ebff", "#6b6250", 1);
  const sun = new THREE.DirectionalLight("#fff6e8", 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 50 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(fill, sun, sun.target);

  // the windows of every castle share this, so night lights them all
  const windowGlow = new THREE.MeshStandardMaterial({ color: "#3a3020", emissive: "#ffb455", emissiveIntensity: 0 });

  const materials = new Map();
  const material = (colour) => {
    if (!materials.has(colour)) {
      materials.set(colour, new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9 }));
    }
    return materials.get(colour);
  };
  const box = new THREE.BoxGeometry(1, 1, 1);

  const ripples = rippleTexture(7);
  // roads are bumpy dirt. the plain material is what road parts are made
  // with, and look the one they're merged into, with the dirt laid out by
  // where it is on the board so it runs on across a road's pieces
  const roadLook = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, normalMap: dirtTexture(11) });
  roadLook.userData.texturePerUnit = 4;
  const roadPart = new THREE.MeshStandardMaterial({ color: ROAD_COLOUR });
  roadPart.userData.look = roadLook;
  // castle roofs are tiled, in their own colours. tileSize is how wide and
  // tall one repeat of the texture is, four tiles across and four rows up
  const [tileShape, tileShade] = tileTextures();
  const roofLook = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, normalMap: tileShape, map: tileShade });
  roofLook.userData.tileSize = [0.2, 0.14];
  const roofParts = new Map();
  const roofPart = (colour) => {
    if (!roofParts.has(colour)) {
      const part = new THREE.MeshStandardMaterial({ color: colour });
      part.userData.look = roofLook;
      roofParts.set(colour, part);
    }
    return roofParts.get(colour);
  };

  // a field's soil, its furrows turned to run along its rows
  const furrows = [false, true].map((across) => {
    const tex = patternTexture(across ? 2 : 1, drawFurrows);
    tex.center.set(0.5, 0.5);
    tex.rotation = across ? 0 : Math.PI / 2;
    return tex;
  });
  const fieldMaterials = new Map();
  const field = (tone, across) => {
    const key = `${tone}:${across}`;
    if (!fieldMaterials.has(key)) {
      fieldMaterials.set(key, new THREE.MeshStandardMaterial({ color: tone, map: furrows[across ? 1 : 0], roughness: 0.95 }));
    }
    return fieldMaterials.get(key);
  };
  const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const solid = (geometry, colour, [sx, sy, sz], [x, y, z]) => {
    const m = new THREE.Mesh(geometry, typeof colour === "string" ? material(colour) : colour);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  // groups that are rebuilt when the board or theme changes, or every render
  const landGroup = new THREE.Group();
  const pieceGroup = new THREE.Group();
  const roadGroup = new THREE.Group();
  const overlayGroup = new THREE.Group();
  scene.add(landGroup, pieceGroup, roadGroup, overlayGroup);

  let landFor = null;
  let pieces = new Map();
  let roads = new Map();
  let breakSeen = new Map();
  let animate = false;
  let hour = null;
  let board = null;
  // for each cell beside the river or a hedge, the [dx, dz] steps towards it
  let riverside = new Map();
  let hedgeside = new Map();

  const cellCentre = (b, i) => [b.colOf(i) - b.n / 2 + 0.5, b.rowOf(i) - b.n / 2 + 0.5];

  // the diorama: a slab of soil, a tile per cell in its region's colour with
  // a little gap between for the grid, hedgerows between regions, and an
  // invisible floor below that only catches the slab's shadow
  function drawLand(b, theme, biomes) {
    landGroup.clear();
    const n = b.n;
    landGroup.add(solid(box, SOIL, [n + 0.4, 0.7, n + 0.4], [0, -0.35, 0]));
    // a soft shadow under the slab, the same at every hour, so it looks like
    // it floats just above the page
    const blob = document.createElement("canvas");
    blob.width = blob.height = 128;
    const ctx = blob.getContext("2d");
    const glow = ctx.createRadialGradient(64, 64, 20, 64, 64, 64);
    glow.addColorStop(0, "rgba(0,0,0,0.45)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(n * 1.35, n * 1.35).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(blob), transparent: true, depthWrite: false }),
    );
    shadow.position.set(0.3, -1.2, 0.5);
    landGroup.add(shadow);
    // a plain tile per cell in its region's colour
    for (let i = 0; i < b.N; i++) {
      const [x, z] = cellCentre(b, i);
      const tile = solid(box, theme.land(biomes[b.regions[i]]), [0.97, TOP, 0.97], [x, TOP / 2, z]);
      tile.castShadow = false;
      landGroup.add(tile);
    }

    // a river along one border from side to side, a flat ribbon of water
    // through its corners with each bend rounded off
    const river = riverEdges(b);
    const onRiver = new Set();
    riverside = new Map();
    hedgeside = new Map();
    const beside = (sides, i, step) => {
      if (!sides.has(i)) sides.set(i, []);
      sides.get(i).push(step);
    };
    for (const [x1, y1, x2, y2] of river) {
      const [x, y] = [Math.min(x1, x2), Math.min(y1, y2)];
      onRiver.add(`${x},${y},${x1 === x2 ? "v" : "h"}`);
      if (x1 === x2) {
        beside(riverside, y * n + x - 1, [1, 0]);
        beside(riverside, y * n + x, [-1, 0]);
      } else {
        beside(riverside, (y - 1) * n + x, [0, 1]);
        beside(riverside, y * n + x, [0, -1]);
      }
    }
    if (river.length) {
      const corners = [river[0].slice(0, 2), ...river.map((e) => e.slice(2))].map(([x, y]) => [x - n / 2, y - n / 2]);
      const line = [];
      corners.forEach((v, k) => {
        const [prev, next] = [corners[k - 1], corners[k + 1]];
        if (!prev || !next || (prev[0] === next[0] || prev[1] === next[1])) {
          line.push(v);
          return;
        }
        // a curve from 0.4 before the bend to 0.4 after it
        const a = [v[0] + 0.4 * (prev[0] - v[0]), v[1] + 0.4 * (prev[1] - v[1])];
        const c = [v[0] + 0.4 * (next[0] - v[0]), v[1] + 0.4 * (next[1] - v[1])];
        for (let j = 0; j <= 6; j++) {
          const t = j / 6;
          const [p, q, r] = [(1 - t) ** 2, 2 * (1 - t) * t, t ** 2];
          line.push([p * a[0] + q * v[0] + r * c[0], p * a[1] + q * v[1] + r * c[1]]);
        }
      });
      // a strip along the river with the given cross section, a list of
      // [offset from the middle, height, colour] from one side to the other
      const strip = (profile, look) => {
        const shades = profile.map(([, , c]) => new THREE.Color(c));
        const [position, color, uv] = [[], [], []];
        // how far along the river, for textures to follow it, a repeat
        // every half a cell
        let along = 0;
        line.forEach(([x, z], k) => {
          const [p, q] = [line[Math.max(k - 1, 0)], line[Math.min(k + 1, line.length - 1)]];
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
          const [nx, nz] = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len];
          if (k > 0) along += Math.hypot(x - line[k - 1][0], z - line[k - 1][1]);
          profile.forEach(([off, h], j) => {
            position.push(x + nx * off, TOP + h, z + nz * off);
            color.push(shades[j].r, shades[j].g, shades[j].b);
            uv.push(off / 0.5, along / 0.5);
          });
        });
        const cols = profile.length;
        const index = [];
        for (let k = 0; k < line.length - 1; k++) {
          for (let j = 0; j < cols - 1; j++) {
            const [a, c] = [k * cols + j, k * cols + j + 1];
            index.push(a, a + cols, c, c, a + cols, c + cols);
          }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(color, 3));
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
        geometry.setIndex(index);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, look);
        mesh.receiveShadow = true;
        landGroup.add(mesh);
      };
      // water, deep almost out to the banks, smooth and rippled so the sun
      // glints off it here and there
      const [shallow, deep] = WATER;
      const water = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, normalMap: ripples });
      strip([[0.1, 0.01, shallow], [0.075, 0.01, deep], [-0.075, 0.01, deep], [-0.1, 0.01, shallow]], water);
      // a low muddy bank either side, standing a little above the water, so
      // the river looks sunk into the land
      const [top, wet] = BANK;
      const mud = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
      strip([[0.155, 0, top], [0.125, 0.03, top], [0.1, 0.01, wet]], mud);
      strip([[-0.1, 0.01, wet], [-0.125, 0.03, top], [-0.155, 0, top]], mud);
    }

    // hedges: a row of bumps along every other edge between regions
    const rng = makeRng(hashString(`${b.regions}:hedges`));
    const bumps = [];
    for (let i = 0; i < b.N; i++) {
      const r = b.rowOf(i);
      const c = b.colOf(i);
      const [x, z] = cellCentre(b, i);
      if (c < n - 1 && b.regions[i] !== b.regions[i + 1] && !onRiver.has(`${c + 1},${r},v`)) {
        for (let k = 0; k <= 6; k++) bumps.push([x + 0.5, z - 0.5 + k / 6]);
        beside(hedgeside, i, [1, 0]);
        beside(hedgeside, i + 1, [-1, 0]);
      }
      if (r < n - 1 && b.regions[i] !== b.regions[i + n] && !onRiver.has(`${c},${r + 1},h`)) {
        for (let k = 0; k <= 6; k++) bumps.push([x - 0.5 + k / 6, z + 0.5]);
        beside(hedgeside, i, [0, 1]);
        beside(hedgeside, i + n, [0, -1]);
      }
    }
    const hedge = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), material("#ffffff"), bumps.length);
    const m = new THREE.Matrix4();
    const colour = new THREE.Color();
    bumps.forEach(([x, z], k) => {
      const s = 0.09 + rng() * 0.04;
      m.makeScale(s, s * (0.9 + rng() * 0.4), s);
      m.setPosition(x + (rng() - 0.5) * 0.03, TOP + s * 0.8, z + (rng() - 0.5) * 0.03);
      hedge.setMatrixAt(k, m);
      hedge.setColorAt(k, colour.set(pick(rng, HEDGE)));
    });
    hedge.castShadow = true;
    hedge.receiveShadow = true;
    landGroup.add(hedge);
  }

  // castle parts, all added to group g, with heights in board units where a
  // cell is 1 across
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
  const cone = new THREE.ConeGeometry(1, 1, 12);
  const pyramid = new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4);
  const pane = new THREE.PlaneGeometry(1, 1);

  // a window that glows at night, facing out at angle `turn` round y
  function windowAt(g, x, y, z, turn, w = 0.04, h = 0.06) {
    const m = new THREE.Mesh(pane, windowGlow);
    m.scale.set(w, h, 1);
    m.rotation.y = turn;
    m.position.set(x, y, z);
    g.add(m);
  }

  // a straight wall from (ax, az) to (bx, bz), with merlons along its top
  function wall(g, stone, ax, az, bx, bz, h, t = 0.07) {
    const len = Math.hypot(bx - ax, bz - az);
    const turn = Math.atan2(bz - az, bx - ax);
    const w = new THREE.Group();
    w.add(solid(box, stone, [len, h, t], [0, h / 2, 0]));
    const count = Math.max(2, Math.round(len / 0.07));
    for (let k = 0; k < count; k += 2) {
      const along = -len / 2 + (len * (k + 0.5)) / count;
      w.add(solid(box, stone, [len / count, 0.035, t], [along, h + 0.0175, 0]));
    }
    w.position.set((ax + bx) / 2, 0, (az + bz) / 2);
    w.rotation.y = -turn;
    g.add(w);
  }

  // a round tower, with a pointed roof or a crenellated top, and a window
  // or two looking out from the castle's centre
  function tower(g, rng, stone, roof, x, z, r, h) {
    g.add(solid(cylinder, stone, [r, h, r], [x, h / 2, z]));
    if (rng() < 0.65) {
      g.add(solid(cone, roof, [r * 1.25, r * 2.4, r * 1.25], [x, h + r * 1.2, z]));
    } else {
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k;
        g.add(solid(box, stone, [r * 0.45, 0.04, r * 0.45], [x + Math.cos(a) * r * 0.8, h + 0.02, z + Math.sin(a) * r * 0.8]));
      }
    }
    const out = Math.atan2(x, z);
    windowAt(g, x + Math.sin(out) * (r + 0.002), h * 0.7, z + Math.cos(out) * (r + 0.002), out);
  }

  // a square keep, sometimes with turrets at its corners, under a pyramid
  // roof, with rows of windows, and now and then a flag on top
  function keep(g, rng, stone, roof, x, z, k, h) {
    g.add(solid(box, stone, [2 * k, h, 2 * k], [x, h / 2, z]));
    g.add(solid(pyramid, roof, [k * 1.5, k * 1.6, k * 1.5], [x, h + k * 0.8, z]));
    if (rng() < 0.5) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const [tx, tz] = [x + sx * k, z + sz * k];
        g.add(solid(cylinder, stone, [0.045, h + 0.08, 0.045], [tx, (h + 0.08) / 2, tz]));
        g.add(solid(cone, roof, [0.06, 0.12, 0.06], [tx, h + 0.14, tz]));
      }
    }
    for (const [dx, dz, turn] of [[0, 1, 0], [1, 0, Math.PI / 2], [0, -1, Math.PI], [-1, 0, -Math.PI / 2]]) {
      for (const level of [0.4, 0.72]) {
        for (const along of [-k / 2.5, k / 2.5]) {
          windowAt(g, x + dx * (k + 0.002) + (dz ? along : 0), h * level, z + dz * (k + 0.002) + (dx ? along : 0), turn);
        }
      }
    }
    if (rng() < 0.4) {
      const top = h + k * 1.6;
      g.add(solid(cylinder, "#4a3a2a", [0.008, 0.2, 0.008], [x, top + 0.1, z]));
      g.add(solid(box, pick(rng, FLAGS), [0.09, 0.055, 0.005], [x + 0.045, top + 0.17, z]));
    }
  }

  // a long hall with a ridged roof, its long side along x if `wide`
  function hall(g, rng, stone, roof, x, z, len, w, h, wide) {
    const [sx, sz] = wide ? [len, w] : [w, len];
    g.add(solid(box, stone, [sx, h, sz], [x, h / 2, z]));
    const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0, 1, 1, 3, 1).rotateX(Math.PI / 2), roof);
    ridge.scale.set(w * 0.62, 0.16, len);
    ridge.rotation.y = wide ? Math.PI / 2 : 0;
    ridge.position.set(x, h + 0.08, z);
    ridge.castShadow = ridge.receiveShadow = true;
    g.add(ridge);
    for (let k = -1; k <= 1; k++) {
      const along = (k * len) / 3;
      const [wx, wz] = wide ? [x + along, z + w / 2 + 0.002] : [x + w / 2 + 0.002, z + along];
      windowAt(g, wx, h * 0.55, wz, wide ? 0 : Math.PI / 2, 0.035, 0.05);
    }
  }

  // a gatehouse on the wall at (x, z) facing out along angle `turn`: two
  // small towers either side of a dark gateway
  function gatehouse(g, rng, stone, roof, x, z, turn, h) {
    const [ox, oz] = [Math.cos(turn) * 0.08, -Math.sin(turn) * 0.08];
    for (const s of [-1, 1]) tower(g, rng, stone, roof, x + s * ox, z + s * oz, 0.055, h * 1.25);
    const gate = solid(box, "#2a2018", [0.1, h * 0.7, 0.075], [x, h * 0.35, z]);
    gate.rotation.y = turn;
    g.add(gate);
  }

  // walls round a rectangle with half widths hx and hz, with towers at most
  // corners, sometimes along the sides, and often a gatehouse. with gate, a
  // [dx, dz] step, always a gatehouse on that side
  function bailey(g, rng, stone, roof, hx, hz, h, towerR, gate = null) {
    const corners = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
    for (let k = 0; k < 4; k++) {
      const [[ax, az], [bx, bz]] = [corners[k], corners[(k + 1) % 4]];
      wall(g, stone, ax, az, bx, bz, h);
    }
    for (const [cx, cz] of corners) if (rng() < 0.9) tower(g, rng, stone, roof, cx, cz, towerR, h * 1.6 + rng() * 0.08);
    for (const [cx, cz] of [[0, -hz], [hx, 0], [0, hz], [-hx, 0]]) {
      if (rng() < 0.2) tower(g, rng, stone, roof, cx, cz, towerR * 0.8, h * 1.4);
    }
    if (rng() < 0.7 || gate) {
      let [gx, gz, turn] = pick(rng, [[0, hz, 0], [0, -hz, Math.PI], [hx, 0, Math.PI / 2], [-hx, 0, -Math.PI / 2]]);
      if (gate) [gx, gz, turn] = [gate[0] * hx, gate[1] * hz, Math.atan2(gate[0], gate[1])];
      gatehouse(g, rng, stone, roof, gx, gz, turn, h);
    }
  }

  // a stone castle in one of four layouts, nearly filling its cell: a square
  // bailey round a keep, a long bailey with a keep at one end and a hall, a
  // round shell keep with a great tower, or two walls one inside the other.
  // a castle beside the river, with sides a list of [dx, dz] steps towards
  // it, has its gate on the first with a drawbridge across the water, and one
  // in a bend with the river on three sides is always round
  function castle(rng, roofs, sides = []) {
    const g = new THREE.Group();
    const stone = pick(rng, STONES);
    const roof = roofPart(pick(rng, roofs));
    const river = sides[0] ?? null;
    let layout = Math.floor(rng() * 4);
    if (sides.length >= 3) layout = 2;
    // how far the outer wall reaches towards the river
    let reach;
    if (layout === 0) {
      const h = 0.24 + rng() * 0.06;
      bailey(g, rng, stone, roof, 0.42, 0.42, h, 0.09, river);
      reach = 0.42;
      keep(g, rng, stone, roof, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.08, 0.17 + rng() * 0.04, 0.55 + rng() * 0.2);
    } else if (layout === 1) {
      const wide = rng() < 0.5;
      const [hx, hz] = wide ? [0.44, 0.3] : [0.3, 0.44];
      const h = 0.22 + rng() * 0.05;
      bailey(g, rng, stone, roof, hx, hz, h, 0.08, river);
      reach = river && river[0] ? hx : hz;
      const end = rng() < 0.5 ? -1 : 1;
      const [kx, kz] = wide ? [end * 0.22, 0] : [0, end * 0.22];
      keep(g, rng, stone, roof, kx, kz, 0.14, 0.6 + rng() * 0.15);
      const [lx, lz] = wide ? [-end * 0.12, 0] : [0, -end * 0.12];
      hall(g, rng, stone, roofPart(pick(rng, roofs)), lx, lz, 0.32, 0.18, 0.22, !wide);
    } else if (layout === 2) {
      const R = 0.4;
      const h = 0.24 + rng() * 0.05;
      const n = 14;
      for (let k = 0; k < n; k++) {
        const [a0, a1] = [(2 * Math.PI * k) / n, (2 * Math.PI * (k + 1)) / n];
        wall(g, stone, R * Math.cos(a0), R * Math.sin(a0), R * Math.cos(a1), R * Math.sin(a1), h);
      }
      const turn0 = rng() * Math.PI;
      for (let k = 0, m = 4 + Math.floor(rng() * 3); k < m; k++) {
        const a = turn0 + (2 * Math.PI * k) / m;
        tower(g, rng, stone, roof, R * Math.cos(a), R * Math.sin(a), 0.075, h * 1.5);
      }
      const big = 0.15 + rng() * 0.04;
      const bh = 0.7 + rng() * 0.2;
      g.add(solid(cylinder, stone, [big, bh, big], [0, bh / 2, 0]));
      g.add(solid(cone, roof, [big * 1.2, big * 2.2, big * 1.2], [0, bh + big * 1.1, 0]));
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k;
        for (const level of [0.45, 0.75]) windowAt(g, Math.sin(a) * (big + 0.002), bh * level, Math.cos(a) * (big + 0.002), a);
      }
      if (river) gatehouse(g, rng, stone, roof, river[0] * R, river[1] * R, Math.atan2(river[0], river[1]), h);
      reach = R;
    } else {
      bailey(g, rng, stone, roof, 0.44, 0.44, 0.18, 0.07, river);
      bailey(g, rng, stone, roof, 0.27, 0.27, 0.32, 0.075);
      keep(g, rng, stone, roof, 0, 0, 0.12, 0.62 + rng() * 0.15);
      reach = 0.44;
    }
    if (river) {
      // planks from the gate to just past the far bank, above the fields
      const [dx, dz] = river;
      const [len, mid] = [0.64 - reach, (0.64 + reach) / 2];
      g.add(solid(box, "#6b4a2c", dx ? [len, 0.02, 0.1] : [0.1, 0.02, len], [dx * mid, 0.045, dz * mid]));
    }
    return g;
  }

  // a tree with a round crown on a short trunk
  const trunk = new THREE.CylinderGeometry(0.025, 0.03, 1, 6);
  const crown = new THREE.IcosahedronGeometry(1, 0);
  function tree(g, rng, x, z) {
    const r = 0.1 + rng() * 0.06;
    g.add(solid(trunk, "#5a4128", [1, 0.14, 1], [x, 0.07, z]));
    g.add(solid(crown, pick(rng, TREES), [r, r * 1.1, r], [x, 0.14 + r * 0.8, z]));
  }

  // a farm: two to four fields of the land's crops in rows, and now and then
  // a tree or two, though only rarely out in the open away from any hedge
  function farm(rng, land, crops, hedged) {
    const g = new THREE.Group();
    const across = rng() < 0.5;
    const count = 2 + Math.floor(rng() * 3);
    const width = 0.88 / count;
    for (let k = 0; k < count; k++) {
      const tone = mixColour(land, pick(rng, crops), 0.75 + rng() * 0.2);
      const rows = mixColour(tone, "#2e2616", 0.4);
      const offset = -0.44 + width * (k + 0.5);
      const [sx, sz] = across ? [0.88, width - 0.05] : [width - 0.05, 0.88];
      const [px, pz] = across ? [0, offset] : [offset, 0];
      g.add(solid(box, field(tone, across), [sx, 0.03, sz], [px, 0.015, pz]));
      for (let d = -0.36; d <= 0.36; d += 0.12) {
        const ridge = across ? [0.02, 0.012, sz * 0.9] : [sx * 0.9, 0.012, 0.02];
        const at = across ? [d, 0.036, pz] : [px, 0.036, d];
        g.add(solid(box, rows, ridge, at));
      }
    }
    if (rng() < (hedged ? 0.35 : 0.08)) {
      for (let t = 0, n = 1 + Math.floor(rng() * 3); t < n; t++) {
        const [tx, tz] = [(rng() - 0.5) * 0.6, (rng() - 0.5) * 0.6];
        tree(g, rng, tx, tz);
      }
    }
    return g;
  }

  // a little thatched house with a window facing +z
  const prism = new THREE.CylinderGeometry(0, 1, 1, 3, 1).rotateX(Math.PI / 2);
  function hut(rng) {
    const [w, d, h] = [0.08 + rng() * 0.04, 0.06 + rng() * 0.03, 0.055 + rng() * 0.03];
    const house = new THREE.Group();
    house.add(solid(box, pick(rng, WALLS), [w, h, d], [0, 0.03 + h / 2, 0]));
    const roof = new THREE.Mesh(prism, material(pick(rng, THATCH)));
    roof.scale.set(d * 0.7, 0.06, w * 1.1);
    roof.rotation.y = Math.PI / 2;
    roof.position.y = 0.03 + h + 0.03;
    roof.castShadow = roof.receiveShadow = true;
    house.add(roof);
    windowAt(house, 0, 0.03 + h * 0.5, d / 2 + 0.002, 0, 0.02, 0.025);
    return house;
  }

  // little houses on a farm next to castles, huddled up against the side
  // nearest each one, so a farm between two castles gets twice as many.
  // towards is a list of [dx, dz] steps from the farm to each castle beside
  // it, and hedges the same for the farm's hedges
  function houses(g, rng, towards, hedges = []) {
    for (const [dx, dz] of towards) {
      // as near the castle as a hedge in the way allows, in each direction,
      // so one at a corner gets houses right into that corner
      const hedged = (hx, hz) => hedges.some(([ax, az]) => ax === hx && az === hz);
      const near = (hx, hz) => (hedged(hx, hz) ? 0.33 : 0.42) - rng() * 0.15;
      const across = () => (rng() - 0.5) * 0.5;
      for (let k = 0, n = 2 + Math.floor(rng() * 2); k < n; k++) {
        const [x, z] = [dx ? dx * near(dx, 0) : across(), dz ? dz * near(0, dz) : across()];
        const house = hut(rng);
        house.position.set(x, 0, z);
        house.rotation.y = (rng() < 0.5 ? 0 : Math.PI / 2) + (rng() - 0.5) * 0.4;
        g.add(house);
      }
    }
  }

  // a piece's parts merged into one mesh per look, with each part's colour
  // kept in its vertices, so a whole castle or farm costs a few draw calls
  // rather than dozens
  const plainLook = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const furrowLooks = furrows.map((map) => new THREE.MeshStandardMaterial({ vertexColors: true, map, roughness: 0.95 }));
  function bake(g) {
    g.updateMatrixWorld(true);
    const parts = new Map();
    g.traverse((m) => {
      if (!m.isMesh) return;
      const look =
        m.material === windowGlow
          ? windowGlow
          : (m.material.userData.look ?? (m.material.map ? furrowLooks[furrows.indexOf(m.material.map)] : plainLook));
      const key = `${look.uuid}:${m.castShadow}`;
      if (!parts.has(key)) parts.set(key, { look, shadow: m.castShadow, geometries: [] });
      const geometry = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      geometry.applyMatrix4(m.matrixWorld);
      // roof uvs stretched by each roof's size, so its tiles come out the same
      // size on every roof. round its sides, and up its height or length
      const tile = look.userData.tileSize;
      if (tile) {
        const { x: sx, y: sy, z: sz } = m.scale;
        const uv = geometry.attributes.uv;
        for (let k = 0; k < uv.count; k++) {
          uv.setXY(k, (uv.getX(k) * 2 * Math.PI * sx) / tile[0], (uv.getY(k) * Math.max(sy, sz)) / tile[1]);
        }
      }
      const per = look.userData.texturePerUnit;
      if (per) {
        const pos = geometry.attributes.position;
        const uv = Array.from({ length: pos.count }, (_, k) => [pos.getX(k) * per, pos.getZ(k) * per]).flat();
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      }
      if (look !== windowGlow) {
        const { r, g: green, b } = m.material.color;
        const count = geometry.attributes.position.count;
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(Array.from({ length: count }, () => [r, green, b]).flat(), 3));
      }
      parts.get(key).geometries.push(geometry);
    });
    const out = new THREE.Group();
    for (const { look, shadow, geometries } of parts.values()) {
      const merged = new THREE.BufferGeometry();
      for (const name of Object.keys(geometries[0].attributes)) {
        const arrays = geometries.map((geometry) => geometry.attributes[name].array);
        const all = new Float32Array(arrays.reduce((total, a) => total + a.length, 0));
        arrays.reduce((at, a) => (all.set(a, at), at + a.length), 0);
        merged.setAttribute(name, new THREE.BufferAttribute(all, geometries[0].attributes[name].itemSize));
      }
      const mesh = new THREE.Mesh(merged, look);
      mesh.castShadow = shadow;
      mesh.receiveShadow = look !== windowGlow;
      out.add(mesh);
    }
    return out;
  }

  // a farm beside the river: a watermill on the first bank in sides, a list
  // of [dx, dz] steps towards the river, and huts strung along every bank
  function riverbank(g, rng, sides) {
    sides.forEach(([dx, dz], k) => {
      // built with the river towards +z, then turned to face it
      const bank = new THREE.Group();
      const taken = k === 0 ? mill(bank, rng) : null;
      // further along, only on the first bank, so huts on two banks meeting
      // at a corner stay apart
      for (const v of k === 0 ? [-0.36, -0.18, 0, 0.18, 0.36] : [-0.18, 0, 0.18]) {
        if ((taken !== null && Math.abs(v - taken) < 0.22) || rng() < 0.4) continue;
        const house = hut(rng);
        house.position.set(v + (rng() - 0.5) * 0.04, 0, 0.3 + (rng() - 0.5) * 0.04);
        house.rotation.y = (rng() - 0.5) * 0.3;
        bank.add(house);
      }
      bank.rotation.y = Math.atan2(dx, dz);
      g.add(bank);
    });
  }

  // a farm beside a hedge: trees grown up out of it, a hut or two, and now
  // and then a woodcutter's log cabin, along every hedge in sides, a list of
  // [dx, dz] steps towards them
  function hedgerow(g, rng, sides) {
    sides.forEach(([dx, dz], k) => {
      // built with the hedge towards +z, then turned to face it
      const row = new THREE.Group();
      const spots = [-0.22, 0, 0.22];
      // a cabin only by the first hedge, in place of one spot
      const cabinAt = k === 0 && rng() < 0.4 ? pick(rng, spots) : null;
      for (const v of spots) {
        const at = v + (rng() - 0.5) * 0.06;
        const roll = rng();
        if (v === cabinAt) {
          cabin(row, rng, at);
        } else if (roll < 0.45) {
          tree(row, rng, at, 0.36);
        } else if (roll < 0.65) {
          const house = hut(rng);
          house.position.set(at, 0, 0.3);
          house.rotation.y = (rng() - 0.5) * 0.3;
          row.add(house);
        }
      }
      row.rotation.y = Math.atan2(dx, dz);
      g.add(row);
    });
  }

  // a log cabin at v along the hedge at +z, with its window facing away from
  // it and a stack of logs at one end
  const log = new THREE.CylinderGeometry(1, 1, 1, 6).rotateZ(Math.PI / 2);
  function cabin(g, rng, v) {
    const [w, d, h, u] = [0.13 + rng() * 0.03, 0.1, 0.075, 0.28];
    g.add(solid(box, "#6b4a2c", [w, h, d], [v, 0.03 + h / 2, u]));
    const roof = new THREE.Mesh(prism, material("#4a3a2a"));
    roof.scale.set(d * 0.7, 0.06, w * 1.1);
    roof.rotation.y = Math.PI / 2;
    roof.position.set(v, 0.03 + h + 0.03, u);
    roof.castShadow = roof.receiveShadow = true;
    g.add(roof);
    windowAt(g, v, 0.03 + h * 0.5, u - d / 2 - 0.002, Math.PI, 0.02, 0.025);
    // three logs along the bottom and two on top, beside one end wall
    const end = v + (rng() < 0.5 ? -1 : 1) * (w / 2 + 0.045);
    for (const [y, z] of [[0, -0.024], [0, 0], [0, 0.024], [1, -0.012], [1, 0.012]]) {
      g.add(solid(log, "#8a6a44", [0.07, 0.012, 0.012], [end, 0.042 + y * 0.021, u + z]));
    }
  }

  // a watermill on the bank, facing the river at +z, with its wheel turning
  // in the water. gives how far along the bank it is
  const wheel = new THREE.CylinderGeometry(1, 1, 1, 10).rotateX(Math.PI / 2);
  function mill(m, rng) {
    const [w, h, d] = [0.17 + rng() * 0.03, 0.12 + rng() * 0.03, 0.12];
    const [v, u] = [(rng() - 0.5) * 0.3, 0.38 - d / 2];
    m.add(solid(box, pick(rng, WALLS), [w, h, d], [v, 0.03 + h / 2, u]));
    const roof = new THREE.Mesh(prism, material(pick(rng, THATCH)));
    roof.scale.set(d * 0.7, 0.07, w * 1.1);
    roof.rotation.y = Math.PI / 2;
    roof.position.set(v, 0.03 + h + 0.035, u);
    roof.castShadow = roof.receiveShadow = true;
    m.add(roof);
    windowAt(m, v, 0.03 + h * 0.55, u - d / 2 - 0.002, Math.PI, 0.03, 0.035);
    windowAt(m, v + w / 2 + 0.002, 0.03 + h * 0.55, u, Math.PI / 2, 0.03, 0.035);
    m.add(solid(wheel, "#5a4128", [0.1, 0.1, 0.03], [v + w * 0.15, 0.09, 0.41]));
    return v;
  }

  // a dirt track along a path of cells, stopping at the castle walls
  function road(b, cells) {
    const g = new THREE.Group();
    const pts = cells.map((i) => cellCentre(b, i));
    const along = (a, c, t) => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
    const n = pts.length;
    const line = [along(pts[0], pts[1], 0.45), ...pts.slice(1, -1), along(pts[n - 1], pts[n - 2], 0.45)];
    for (let k = 1; k < line.length; k++) {
      const [[x0, z0], [x1, z1]] = [line[k - 1], line[k]];
      const length = Math.hypot(x1 - x0, z1 - z0) + 0.14;
      const seg = solid(box, roadPart, [x1 !== x0 ? length : 0.14, 0.02, z1 !== z0 ? length : 0.14], [(x0 + x1) / 2, 0.06, (z0 + z1) / 2]);
      g.add(seg);
    }
    return bake(g);
  }

  // keep one object per key in a group, made by make(key) when it first
  // appears, growing in if animating, and drop the rest. the part of a key
  // before any ":" says what and where, so a piece only rebuilt because its
  // neighbours changed is swapped in without growing again
  function sync(group, map, wanted, make) {
    let batch = 0;
    const now = performance.now();
    const there = new Set([...map.keys()].map((key) => key.split(":")[0]));
    for (const key of wanted) {
      if (map.has(key)) continue;
      const obj = make(key);
      const grow = animate && !there.has(key.split(":")[0]);
      obj.userData.born = grow ? now + batch++ * CELL_STAGGER : -Infinity;
      if (grow) obj.scale.setScalar(0.001);
      group.add(obj);
      map.set(key, obj);
    }
    for (const [key, obj] of map) {
      if (!wanted.has(key)) {
        group.remove(obj);
        map.delete(key);
      }
    }
  }

  function setLight() {
    const now = new Date();
    const h = hour ?? now.getHours() + now.getMinutes() / 60;
    const light = lightAt(h);
    // the sun rises in the east and sets in the west, the moon hangs high in
    // the south east all night. neither goes below about 25 degrees, so
    // light never just grazes the board and the puzzle stays easy to read
    const a = ((light.hour - 6) / 12) * Math.PI;
    const day = Math.sin(a) > 0;
    if (day) sun.position.set(Math.cos(a) * 12, 7 + Math.sin(a) * 9, 6);
    else sun.position.set(6, 12, 6);
    sun.color.set(light.sun);
    sun.intensity = light.sunStrength;
    fill.color.set(light.sky);
    fill.groundColor.set(light.ground);
    fill.intensity = light.fill * 1.4;
    windowGlow.emissiveIntensity = 2.5 * light.night;
  }

  let frame = null;
  function frameLoop() {
    frame = null;
    const now = performance.now();
    let growing = false;
    placeCamera();
    for (const map of [pieces, roads]) {
      for (const obj of map.values()) {
        const t = (now - obj.userData.born) / GROW_MS;
        if (t >= 1) {
          if (obj.scale.x !== 1) obj.scale.setScalar(1);
          continue;
        }
        growing = true;
        obj.scale.setScalar(t <= 0 ? 0.001 : Math.max(0.001, easeOutBack(t)));
      }
    }
    gl.render(scene, camera);
    if (growing) requestRender();
  }
  const requestRender = () => {
    frame ??= requestAnimationFrame(frameLoop);
  };

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    gl.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestRender();
  }
  new ResizeObserver(resize).observe(container);
  // follow the clock, checking the light every minute
  setInterval(() => {
    if (hour === null && board) {
      setLight();
      requestRender();
    }
  }, 60000);

  // model: as for the svg renderer, plus hour, a fixed time of day from 0 to
  // 24, or null to follow the clock
  let latest = null;
  let breakTimer = null;

  function render(model) {
    const { theme, biomes, display, breaks, mistakes, tip, solved } = model;
    latest = model;
    board = model.board;
    hour = model.hour ?? null;
    const b = board;
    if (landFor !== `${b.regions}:${theme.label}`) {
      landFor = `${b.regions}:${theme.label}`;
      drawLand(b, theme, biomes);
      pieceGroup.clear();
      roadGroup.clear();
      pieces = new Map();
      roads = new Map();
      animate = false;
    }
    setLight();

    // castles and farms, keyed by cell and what's there. a farm's key also
    // lists the castles beside it, so it is built again with houses when one
    // goes up or comes down nearby
    const wanted = new Set();
    display.forEach((v, i) => {
      if (v === CASTLE) wanted.add(`c${i}`);
      else if (v === ROAD) {
        const near = b.neighbours[i].filter((j) => display[j] === CASTLE);
        wanted.add(`f${i}:${near.join(".")}`);
      }
    });
    sync(pieceGroup, pieces, wanted, (key) => {
      const [cell, near] = key.slice(1).split(":");
      const i = Number(cell);
      const rng = makeRng(hashString(`${b.regions}:${i}`));
      let obj;
      if (key[0] === "c") {
        obj = castle(rng, theme.roofs(biomes[b.regions[i]]), riverside.get(i));
      } else {
        const biome = biomes[b.regions[i]];
        obj = farm(rng, theme.land(biome), theme.crops(biome), hedgeside.has(i));
        const towards = near ? near.split(".").map(Number).map((j) => [b.colOf(j) - b.colOf(i), b.rowOf(j) - b.rowOf(i)]) : [];
        houses(obj, makeRng(hashString(`${b.regions}:${i}:houses`)), towards, hedgeside.get(i));
        if (riverside.has(i)) riverbank(obj, makeRng(hashString(`${b.regions}:${i}:mill`)), riverside.get(i));
        if (hedgeside.has(i)) hedgerow(obj, makeRng(hashString(`${b.regions}:${i}:hedge`)), hedgeside.get(i));
      }
      obj = bake(obj);
      const [x, z] = cellCentre(b, i);
      obj.position.set(x, TOP, z);
      return obj;
    });

    // a track between a region's castles once it has them all
    const paths = new Set();
    for (const unit of b.units) {
      if (unit.kind !== "region") continue;
      const stars = unit.cells.filter((i) => display[i] === CASTLE);
      if (stars.length !== b.k || stars.length < 2) continue;
      for (let s = 1; s < stars.length; s++) paths.add(regionPath(b, stars[s - 1], stars[s]).join(","));
    }
    sync(roadGroup, roads, paths, (key) => {
      const obj = road(b, key.split(",").map(Number));
      obj.position.y = TOP;
      return obj;
    });

    // flat coloured squares over cells, for rule breaks, tips and mistakes
    overlayGroup.clear();
    const tint = (i, colour, opacity) => {
      const [x, z] = cellCentre(b, i);
      const mat = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false, depthTest: false });
      const m = new THREE.Mesh(plane, mat);
      m.position.set(x, OVERLAY, z);
      m.renderOrder = 10;
      overlayGroup.add(m);
    };
    const now = performance.now();
    const seen = new Map();
    let pending = false;
    const due = (key) => {
      const first = breakSeen.get(key) ?? now;
      seen.set(key, first);
      if (now - first < BREAK_DELAY) pending = true;
      return now - first >= BREAK_DELAY;
    };
    for (const ui of breaks.units) {
      if (due(`u${ui}`)) for (const i of b.units[ui].cells) tint(i, "#e0453a", 0.3);
    }
    for (const i of breaks.cells) if (due(`c${i}`)) tint(i, "#e0453a", 0.45);
    breakSeen = seen;
    // draw again once the newest breaks are due, from whatever the board is
    // by then, not this model, which may be out of date
    clearTimeout(breakTimer);
    if (pending) breakTimer = setTimeout(() => render(latest), BREAK_DELAY);
    if (tip) {
      if (tip.units.length) {
        const lit = new Set(tip.units.flatMap((ui) => b.units[ui].cells));
        for (let i = 0; i < b.N; i++) if (!lit.has(i)) tint(i, "#10161a", 0.5);
      }
      for (const i of tip.blocked) tint(i, "#2f6fd6", 0.35);
      for (const i of tip.stars) tint(i, "#f2c14e", 0.45);
    }
    for (const i of mistakes) tint(i, "#e8892c", 0.45);

    // a gentle hop of every castle when the puzzle is solved
    if (solved && !pieceGroup.userData.cheered) {
      pieceGroup.userData.cheered = true;
      let k = 0;
      for (const [key, obj] of pieces) if (key[0] === "c") obj.userData.born = now + k++ * 60;
    }
    if (!solved) pieceGroup.userData.cheered = false;

    animate = true;
    resize();
    requestRender();
  }

  // which cell a pointer event is over, by finding where it meets the tiles
  const ray = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP);
  function cellAt(b, e) {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(ground, hit)) return -1;
    const c = Math.floor(hit.x + b.n / 2);
    const r = Math.floor(hit.z + b.n / 2);
    if (r < 0 || c < 0 || r >= b.n || c >= b.n) return -1;
    return r * b.n + c;
  }

  // turn the view by dragging: across turns it, a full turn per 600 pixels,
  // with the board following the finger, and up and down tilts it
  function orbit(dx, dy) {
    yaw -= (dx / 600) * 2 * Math.PI;
    tilt = clamp(tilt - dy * 0.005, TILT[0], TILT[1]);
    requestRender();
  }

  // zoom in for factor below 1, out above it
  function zoomBy(factor) {
    zoom = clamp(zoom * factor, ZOOM[0], ZOOM[1]);
    requestRender();
  }

  return { render, cellAt, orbit, zoomBy };
}
