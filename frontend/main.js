import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ──────────────────────────────────────────────────────────── renderer & scene
const container = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
container.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', pointerEvents: 'none' });
container.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060c);
scene.fog = new THREE.Fog(0x05060c, 26, 55);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 1.7, 12);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.45, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ──────────────────────────────────────────────────────────── helpers
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...o });
const glow = (color, intensity = 2) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity });
function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; return mesh;
}
function canvasTex(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return { c, ctx: c.getContext('2d'), tex: t };
}

// ──────────────────────────────────────────────────────────── the room (futuristic command deck)
const ROOM = { w: 28, d: 24, h: 7 };
const updaters = [];            // per-frame animation callbacks: (t, dt) => void
const NEON = { blue: 0x2f7bff, cyan: 0x22e1ff, violet: 0x9b4dff, gold: 0xf5c542 };
const physical = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.25, metalness: 0.8, clearcoat: 1, clearcoatRoughness: 0.15, ...o });
const additive = (color, opacity = 0.5) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
{
  // ── glossy floor with circuit pattern + glowing emissive lines
  const S = 1024;
  const base = canvasTex(S, S), em = canvasTex(S, S);
  base.ctx.fillStyle = '#0b0e18'; base.ctx.fillRect(0, 0, S, S);
  em.ctx.fillStyle = '#000'; em.ctx.fillRect(0, 0, S, S);
  // hex tiles
  const r = 46, hh = Math.sqrt(3) * r;
  base.ctx.strokeStyle = '#161c2c'; base.ctx.lineWidth = 3;
  for (let y = -hh; y < S + hh; y += hh) for (let x = -r * 3, row = 0; x < S + r * 3; x += r * 3, row++) {
    for (const [ox, oy] of [[0, 0], [r * 1.5, hh / 2]]) {
      base.ctx.beginPath();
      for (let k = 0; k <= 6; k++) { const a = Math.PI / 3 * k; base.ctx.lineTo(x + ox + r * Math.cos(a), y + oy + r * Math.sin(a)); }
      base.ctx.stroke();
    }
  }
  // circuit traces (emissive)
  em.ctx.strokeStyle = '#1d4dff'; em.ctx.lineWidth = 3; em.ctx.lineCap = 'round';
  for (let i = 0; i < 38; i++) {
    let x = Math.random() * S, y = Math.random() * S; em.ctx.beginPath(); em.ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) { if (Math.random() > .5) x += (Math.random() - .5) * 400; else y += (Math.random() - .5) * 400; em.ctx.lineTo(x, y); }
    em.ctx.stroke(); em.ctx.fillStyle = '#4fd2ff'; em.ctx.beginPath(); em.ctx.arc(x, y, 6, 0, 7); em.ctx.fill();
  }
  for (const t of [base.tex, em.tex]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3); }
  const floorM = new THREE.MeshPhysicalMaterial({ map: base.tex, emissiveMap: em.tex, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.18, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.08 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), floorM);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  updaters.push(t => { floorM.emissiveIntensity = 0.45 + Math.sin(t * 0.8) * 0.2; });

  // concentric floor rings around the command table
  for (const [rad, col] of [[3.2, NEON.gold], [5.2, NEON.blue], [11, NEON.violet]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(rad, rad + 0.04, 128), additive(col, 0.55));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.012; scene.add(ring);
  }

  // ── walls: dark panels with recessed light slits
  const wallM = physical(0x111521, { metalness: 0.6, roughness: 0.45 });
  const panelM = physical(0x171c2b, { metalness: 0.7, roughness: 0.35 });
  scene.add(box(ROOM.w, ROOM.h, 0.3, wallM, 0, ROOM.h / 2, -ROOM.d / 2));
  scene.add(box(ROOM.w, ROOM.h, 0.3, wallM, 0, ROOM.h / 2, ROOM.d / 2));
  for (const s of [-1, 1]) scene.add(box(0.3, ROOM.h, ROOM.d, wallM, s * ROOM.w / 2, ROOM.h / 2, 0));
  // back wall: vertical panels + light slits (leave room for the mission board)
  for (let x = -ROOM.w / 2 + 1; x < ROOM.w / 2; x += 2) {
    if (Math.abs(x) < 6) continue;
    scene.add(box(1.8, ROOM.h - 1.2, 0.12, panelM, x, ROOM.h / 2, -ROOM.d / 2 + 0.2));
    scene.add(box(0.04, ROOM.h - 1.6, 0.04, glow(NEON.blue, 2.2), x + 0.95, ROOM.h / 2, -ROOM.d / 2 + 0.27));
  }
  // front wall: glowing portal entrance
  {
    const door = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.07, 16, 64, Math.PI), glow(NEON.cyan, 3));
    door.position.set(0, 2.6, ROOM.d / 2 - 0.2); scene.add(door);
    for (const sx of [-1.8, 1.8]) scene.add(box(0.14, 2.6, 0.14, glow(NEON.cyan, 3), sx, 1.3, ROOM.d / 2 - 0.2));
    const field = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 4.4), additive(NEON.cyan, 0.07)); field.position.set(0, 2.2, ROOM.d / 2 - 0.22); scene.add(field);
  }

  // ── ceiling: dark coffers + giant halo light over the command table
  scene.add(box(ROOM.w, 0.2, ROOM.d, physical(0x0a0c14, { metalness: 0.4 }), 0, ROOM.h, 0));
  for (let x = -12; x <= 12; x += 6) scene.add(box(0.08, 0.06, ROOM.d - 1, glow(NEON.blue, 1.2), x, ROOM.h - 0.12, 0));
  const halo = new THREE.Mesh(new THREE.TorusGeometry(4, 0.06, 16, 128), glow(0xdfe8ff, 1.1));
  halo.rotation.x = Math.PI / 2; halo.position.y = ROOM.h - 0.5; scene.add(halo);
  const halo2 = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.04, 16, 128), glow(NEON.gold, 2));
  halo2.rotation.x = Math.PI / 2; halo2.position.y = ROOM.h - 0.75; scene.add(halo2);
  updaters.push(t => { halo2.rotation.z = t * 0.2; });

  // neon floor & ceiling trims around the whole room
  const trim = (w, d, x, z, y, col) => scene.add(box(w, 0.04, d, glow(col, 3), x, y, z));
  for (const y of [0.06, ROOM.h - 0.3]) {
    const col = y < 1 ? NEON.blue : NEON.violet;
    trim(ROOM.w - 0.6, 0.04, 0, -ROOM.d / 2 + 0.32, y, col); trim(ROOM.w - 0.6, 0.04, 0, ROOM.d / 2 - 0.32, y, col);
    trim(0.04, ROOM.d - 0.6, -ROOM.w / 2 + 0.32, 0, y, col); trim(0.04, ROOM.d - 0.6, ROOM.w / 2 - 0.32, 0, y, col);
  }

  // ── panoramic windows: night megacity with flying traffic
  for (const s of [-1, 1]) {
    const W = 2048, H = 640, sky = canvasTex(W, H), c2 = sky.ctx;
    const g = c2.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#02030a'); g.addColorStop(0.55, '#140a3a'); g.addColorStop(1, '#5a1a6e');
    c2.fillStyle = g; c2.fillRect(0, 0, W, H);
    for (let i = 0; i < 260; i++) { c2.fillStyle = `rgba(255,255,255,${Math.random() * 0.8})`; c2.fillRect(Math.random() * W, Math.random() * H * 0.5, 1.5, 1.5); }
    c2.fillStyle = 'rgba(255,120,220,0.15)'; c2.beginPath(); c2.arc(W * 0.7, H * 0.35, 90, 0, 7); c2.fill(); // moon haze
    for (const [layer, col, minH, maxH] of [[0, '#120c2a', 120, 330], [1, '#07060f', 180, 520]]) {
      for (let x = 0; x < W;) {
        const bw = 30 + Math.random() * 90, bh = minH + Math.random() * (maxH - minH);
        c2.fillStyle = col; c2.fillRect(x, H - bh, bw, bh);
        if (layer === 1) {
          if (Math.random() > 0.6) { c2.fillStyle = Math.random() > .5 ? '#22e1ff' : '#ff4fd8'; c2.fillRect(x, H - bh, bw, 3); }
          for (let k = 0; k < bh / 9; k++) if (Math.random() > .55) { c2.fillStyle = ['#ffd46b', '#6bc7ff', '#ff6bd5'][(Math.random() * 3) | 0]; c2.fillRect(x + 4 + Math.random() * (bw - 10), H - Math.random() * bh, 3, 2); }
        }
        x += bw + Math.random() * 8;
      }
    }
    const win = new THREE.Mesh(new THREE.PlaneGeometry(16, 4.6), new THREE.MeshBasicMaterial({ map: sky.tex, toneMapped: false }));
    win.position.set(s * (ROOM.w / 2 - 0.17), 3.3, -0.5); win.rotation.y = -s * Math.PI / 2; scene.add(win);
    // mullions
    for (let z = -8.5; z <= 7.5; z += 2) scene.add(box(0.1, 4.8, 0.1, physical(0x1a1f2e), s * (ROOM.w / 2 - 0.25), 3.3, z));
    scene.add(box(0.12, 0.12, 16.2, glow(NEON.cyan, 2), s * (ROOM.w / 2 - 0.25), 1.0, -0.5));
    // flying cars outside
    const cars = [];
    for (let i = 0; i < 7; i++) {
      const car = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), glow(i % 2 ? 0xff4fd8 : 0x22e1ff, 6));
      car.userData = { y: 2.2 + Math.random() * 2.6, speed: (0.6 + Math.random() * 1.4) * (Math.random() > .5 ? 1 : -1), off: Math.random() * 16 };
      car.position.x = s * (ROOM.w / 2 - 0.12); scene.add(car); cars.push(car);
    }
    updaters.push(t => cars.forEach(c => { const u = c.userData; c.position.set(c.position.x, u.y + Math.sin(t + u.off) * 0.05, -8.5 + ((u.off + t * u.speed) % 16 + 16) % 16); }));
  }

  // ── lights
  scene.add(new THREE.HemisphereLight(0x6f8cff, 0x14081c, 0.45));
  const key = new THREE.DirectionalLight(0xdfe6ff, 0.9);
  key.position.set(6, 14, 8); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0005;
  Object.assign(key.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16 }); scene.add(key);
  const center = new THREE.PointLight(0xffe2a0, 8, 14, 1.7); center.position.set(0, ROOM.h - 1, 0); scene.add(center);
  for (const [x, z, col] of [[-9, -6, NEON.cyan], [9, -6, NEON.violet], [-9, 6, NEON.blue], [9, 6, 0xff4fd8]]) {
    const p = new THREE.PointLight(col, 10, 10, 1.6); p.position.set(x, 4.5, z); scene.add(p);
  }

  // ── server racks in the back corners with blinking LEDs
  const leds = [];
  for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) {
    const rack = new THREE.Group();
    rack.add(box(1.1, 3.2, 0.9, physical(0x0d1019, { metalness: 0.9, roughness: 0.3 }), 0, 1.6, 0));
    rack.add(box(1.0, 3.0, 0.02, additive(0x2f7bff, 0.12), 0, 1.6, 0.46));
    for (let y = 0.3; y < 3; y += 0.18) for (let k = 0; k < 5; k++) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.025, 0.02), glow(Math.random() > .8 ? 0xff4fd8 : NEON.cyan, 3));
      led.position.set(-0.4 + k * 0.08, y, 0.47); rack.add(led); leds.push(led);
    }
    rack.position.set(sx * (ROOM.w / 2 - 1.2 - i * 1.3), 0, -ROOM.d / 2 + 0.9); scene.add(rack);
  }
  updaters.push(() => { for (let i = 0; i < 6; i++) { const l = leds[(Math.random() * leds.length) | 0]; l.visible = !l.visible; } });

  // ── energy pylons (replace plants) at the front corners
  for (const sx of [-1, 1]) {
    const g = new THREE.Group();
    g.add(box(0.9, 0.25, 0.9, physical(0x151a28), 0, 0.12, 0));
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 3.2, 24), glow(NEON.violet, 2.5)); core.position.y = 1.85; g.add(core);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 3.2, 24, 1, true), new THREE.MeshPhysicalMaterial({ color: 0x9fb4ff, transmission: 0.9, roughness: 0.05, thickness: 0.2, transparent: true, opacity: 0.35 }));
    tube.position.y = 1.85; g.add(tube);
    const rings = [0, 1, 2].map(k => { const r = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.02, 8, 32), glow(NEON.cyan, 3)); r.rotation.x = Math.PI / 2; g.add(r); return r; });
    updaters.push(t => rings.forEach((r, k) => { r.position.y = 0.4 + ((t * 0.6 + k / 3) % 1) * 3; }));
    g.position.set(sx * (ROOM.w / 2 - 1.3), 0, ROOM.d / 2 - 1.5); scene.add(g);
  }

  // ── lounge: floating curved sofa
  const sofa = new THREE.Group();
  const seatM = physical(0x232a48, { metalness: 0.2, roughness: 0.6, clearcoat: 0.4 });
  const arcShape = (r0, r1) => { const sh = new THREE.Shape(); sh.absarc(0, 0, r1, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6, false); sh.absarc(0, 0, r0, -Math.PI / 2 + 0.6, -Math.PI / 2 - 0.6, true); return sh; };
  const seat = new THREE.Mesh(new THREE.ExtrudeGeometry(arcShape(2.4, 3.0), { depth: 0.35, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05 }), seatM);
  seat.rotation.x = -Math.PI / 2; seat.position.y = 0.4; seat.castShadow = true; sofa.add(seat);
  const backrest = new THREE.Mesh(new THREE.ExtrudeGeometry(arcShape(2.9, 3.1), { depth: 0.6, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04 }), seatM);
  backrest.rotation.x = -Math.PI / 2; backrest.position.y = 0.75; sofa.add(backrest);
  const under = new THREE.Mesh(new THREE.ShapeGeometry(arcShape(2.45, 2.95)), additive(NEON.blue, 0.5)); under.rotation.x = -Math.PI / 2; under.position.y = 0.05; sofa.add(under);
  sofa.position.set(-7.5, 0, ROOM.d / 2 - 4.8); scene.add(sofa);
  const sofa2 = sofa.clone(); sofa2.position.x = 7.5; scene.add(sofa2);

  // ── floating dust / data motes
  const N = 500, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - .5) * ROOM.w; pos[i * 3 + 1] = Math.random() * ROOM.h; pos[i * 3 + 2] = (Math.random() - .5) * ROOM.d; }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const motes = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x8fc8ff, size: 0.035, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(motes);
  updaters.push((t, dt) => { const a = pg.attributes.position.array; for (let i = 1; i < a.length; i += 3) { a[i] += dt * 0.08; if (a[i] > ROOM.h) a[i] = 0; } pg.attributes.position.needsUpdate = true; });
}

// central holo command table
const holo = new THREE.Group();
{
  const metal = physical(0x1a2033);
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.9, 0.9, 6), metal); pedestal.position.y = 0.45; pedestal.castShadow = true; holo.add(pedestal);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.55, 0.12, 6), metal); top.position.y = 0.96; top.castShadow = true; holo.add(top);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.02, 6), additive(NEON.blue, 0.35)); glass.position.y = 1.03; holo.add(glass);
  const edge = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.025, 8, 6), glow(NEON.gold, 2.5)); edge.rotation.x = Math.PI / 2; edge.rotation.z = Math.PI / 6; edge.position.y = 1.02; holo.add(edge);
  // projector cone
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.25, 1.7, 32, 1, true), additive(0x3d8bff, 0.07)); beam.position.y = 1.9; holo.add(beam);
  // hologram globe: wireframe + solid core + orbit rings
  const globe = new THREE.Group(); globe.position.y = 2.3; holo.add(globe);
  globe.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 3), new THREE.MeshBasicMaterial({ color: 0x5ab0ff, wireframe: true, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false })));
  globe.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), glow(NEON.cyan, 3)));
  const orbits = [0, 1, 2].map(k => {
    const o = new THREE.Mesh(new THREE.TorusGeometry(0.85 + k * 0.15, 0.008, 8, 96), additive([NEON.gold, NEON.cyan, NEON.violet][k], 0.9));
    o.rotation.set(Math.random() * 3, Math.random() * 3, 0); globe.add(o); return o;
  });
  const sats = orbits.map((o, k) => { const s = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), glow([NEON.gold, NEON.cyan, NEON.violet][k], 5)); o.add(s); return s; });
  holo.userData.globe = globe;
  // scanning ring
  const scan = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.012, 8, 64), additive(NEON.cyan, 0.9)); scan.rotation.x = Math.PI / 2; holo.add(scan);
  // orbiting holo data panels
  const panels = [];
  for (let i = 0; i < 4; i++) {
    const p = canvasTex(256, 160), c = p.ctx;
    c.fillStyle = 'rgba(20,60,140,0.35)'; c.fillRect(0, 0, 256, 160);
    c.strokeStyle = '#4fd2ff'; c.lineWidth = 3; c.strokeRect(2, 2, 252, 156);
    c.fillStyle = '#9fe3ff'; c.font = '600 18px "JetBrains Mono", monospace'; c.fillText(['AGENTS', 'GRAPH', 'TASKS', 'NET'][i], 14, 30);
    c.strokeStyle = '#22e1ff'; c.beginPath(); for (let x = 0; x < 230; x += 10) c.lineTo(14 + x, 120 - Math.random() * 60); c.stroke();
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshBasicMaterial({ map: p.tex, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    holo.add(m); panels.push(m);
  }
  updaters.push(t => {
    orbits.forEach((o, k) => { o.rotation.z += 0.01 * (k + 1); });
    sats.forEach((s, k) => { const a = t * (1 + k * 0.4); s.position.set(Math.cos(a) * (0.85 + k * 0.15), Math.sin(a) * (0.85 + k * 0.15), 0); });
    scan.position.y = 1.15 + (Math.sin(t * 1.4) * 0.5 + 0.5) * 2.1;
    scan.scale.setScalar(1 + Math.sin(t * 1.4) * 0.15);
    panels.forEach((m, i) => { const a = t * 0.3 + (i * Math.PI) / 2; m.position.set(Math.cos(a) * 1.55, 2.3 + Math.sin(t + i) * 0.08, Math.sin(a) * 1.55); m.lookAt(0, 2.3, 0); m.rotateY(Math.PI); });
  });
}
scene.add(holo);

// mission board on the back wall (floating holo screen)
const board = canvasTex(1536, 640);
{
  const m = new THREE.Mesh(new THREE.PlaneGeometry(10, 4.2), new THREE.MeshBasicMaterial({ map: board.tex, toneMapped: false }));
  m.position.set(0, 3.6, -ROOM.d / 2 + 0.45); scene.add(m);
  scene.add(box(10.3, 4.5, 0.08, physical(0x0c0f18), 0, 3.6, -ROOM.d / 2 + 0.38));
  for (const [w, h, x, y] of [[10.3, 0.04, 0, 5.87], [10.3, 0.04, 0, 1.33], [0.04, 4.5, -5.15, 3.6], [0.04, 4.5, 5.15, 3.6]])
    scene.add(box(w, h, 0.04, glow(NEON.gold, 2.2), x, y, -ROOM.d / 2 + 0.44));
}
const boardState = { task: 'Waiting for a task…', lines: [] };
function drawBoard() {
  const { ctx, c, tex } = board;
  const g = ctx.createLinearGradient(0, 0, 0, c.height); g.addColorStop(0, '#0a1430'); g.addColorStop(1, '#05070f');
  ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = 'rgba(80,140,255,0.08)'; ctx.lineWidth = 1;
  for (let x = 0; x < c.width; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, c.height); ctx.stroke(); }
  for (let y = 0; y < c.height; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.width, y); ctx.stroke(); }
  ctx.fillStyle = '#f5c542'; ctx.font = '600 34px Inter, sans-serif'; ctx.fillText('◆ MISSION CONTROL', 40, 64);
  ctx.fillStyle = '#22e1ff'; ctx.font = '22px "JetBrains Mono", monospace'; ctx.fillText(new Date().toLocaleTimeString(), c.width - 190, 62);
  ctx.fillStyle = '#e7ecf7'; ctx.font = '600 40px Inter, sans-serif';
  wrapText(ctx, boardState.task, 40, 130, c.width - 80, 48, 2);
  ctx.font = '26px "JetBrains Mono", monospace';
  boardState.lines.slice(-9).forEach((l, i) => { ctx.fillStyle = l.color || '#8a93a8'; ctx.fillText(l.text.slice(0, 92), 40, 260 + i * 40); });
  tex.needsUpdate = true;
}
function wrapText(ctx, text, x, y, maxW, lh, maxLines) {
  const words = String(text).split(/\s+/); let line = '', n = 0;
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, y); y += lh; line = w; if (++n >= maxLines - 1) { line += '…'; break; } }
    else line = t;
  }
  ctx.fillText(line, x, y);
}
drawBoard();
setInterval(drawBoard, 1000);

// ──────────────────────────────────────────────────────────── workstations
const LAYOUT = {
  orchestrator: { home: [0, 2.2], desk: null },
  researcher: { desk: [-8.5, -6], deskRot: Math.PI / 4 },
  coder: { desk: [-8.5, 4.5], deskRot: (3 * Math.PI) / 4 },
  github: { desk: [8.5, -6], deskRot: -Math.PI / 4 },
  operator: { desk: [8.5, 4.5], deskRot: (-3 * Math.PI) / 4 },
};

function makeDesk(color, x, z, rot) {
  const g = new THREE.Group();
  const metal = physical(0x161b2a);
  // floating glass desk on a single sculpted stem
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.35, 0.85, 6), metal); stem.position.y = 0.43; stem.castShadow = true; g.add(stem);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.75, 0.05, 6), metal); base.position.y = 0.025; g.add(base);
  const baseGlow = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.015, 8, 6), glow(color, 3)); baseGlow.rotation.x = Math.PI / 2; baseGlow.position.y = 0.05; g.add(baseGlow);
  const topShape = new THREE.Shape();
  topShape.moveTo(-1.4, -0.45); topShape.lineTo(1.4, -0.45); topShape.quadraticCurveTo(1.6, 0.1, 1.1, 0.6); topShape.lineTo(-1.1, 0.6); topShape.quadraticCurveTo(-1.6, 0.1, -1.4, -0.45);
  const topGeo = new THREE.ExtrudeGeometry(topShape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
  const top = new THREE.Mesh(topGeo, new THREE.MeshPhysicalMaterial({ color: 0x0f1424, metalness: 0.3, roughness: 0.08, clearcoat: 1, transmission: 0.35, transparent: true, opacity: 0.9 }));
  top.rotation.x = Math.PI / 2; top.position.y = 0.92; top.castShadow = true; g.add(top);
  const edgePts = topShape.getPoints(24).map(p => new THREE.Vector3(p.x, 0.88, p.y));
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(edgePts), new THREE.LineBasicMaterial({ color })));
  const edgeTube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edgePts, true), 64, 0.012, 6, true), glow(color, 3)); g.add(edgeTube);
  // curved holographic screen (front surface at z≈-0.3, facing the agent)
  const scr = canvasTex(640, 360);
  const R = 2.4, arc = 0.82;
  const screen = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 1.05, 32, 1, true, -arc / 2, arc),
    new THREE.MeshBasicMaterial({ map: scr.tex, toneMapped: false, transparent: true, opacity: 0.93 }));
  screen.position.set(0, 1.85, -0.3 - R); g.add(screen);
  const frame = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.005, R + 0.005, 1.12, 32, 1, true, -arc / 2 - 0.01, arc + 0.02), new THREE.MeshBasicMaterial({ color: 0x05070d, side: THREE.BackSide }));
  frame.position.copy(screen.position); g.add(frame);
  for (const yy of [1.85 - 0.54, 1.85 + 0.54]) {
    const strip = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.01, R + 0.01, 0.015, 32, 1, true, -arc / 2, arc), glow(color, 3));
    strip.position.set(0, yy, -0.3 - R); g.add(strip);
  }
  // projector beam from desk to screen
  const proj = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.5), additive(color, 0.06)); proj.position.set(0, 1.18, -0.2); proj.rotation.x = -0.35; g.add(proj);
  // holographic keyboard
  const kb = canvasTex(256, 96);
  kb.ctx.strokeStyle = new THREE.Color(color).getStyle(); kb.ctx.lineWidth = 2;
  for (let r = 0; r < 4; r++) for (let k = 0; k < 12; k++) kb.ctx.strokeRect(6 + k * 20.5 + (r % 2) * 5, 6 + r * 22, 17, 17);
  const keyboard = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.35), new THREE.MeshBasicMaterial({ map: kb.tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  keyboard.rotation.x = -Math.PI / 2; keyboard.position.set(0, 1.0, 0.3); g.add(keyboard);
  g.position.set(x, 0, z); g.rotation.y = rot;
  scene.add(g);
  updaters.push(t => { baseGlow.material.emissiveIntensity = 2 + Math.sin(t * 2 + x) * 1; });
  return { group: g, screen: scr, lines: [], scroll: 0 };
}

// ──────────────────────────────────────────────────────────── robots (hover androids)
function makeRobot(color, isBoss = false) {
  const c = new THREE.Color(color);
  const shell = new THREE.MeshPhysicalMaterial({ color: 0xf2f4fa, metalness: 0.25, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0.35, iridescenceIOR: 1.4 });
  const chrome = physical(0x1a1d27, { metalness: 1, roughness: 0.15 });
  const accent = physical(c, { metalness: 0.6, roughness: 0.25 });
  const R = new THREE.Group();
  const lift = new THREE.Group(); lift.position.y = 0.28; R.add(lift);    // hovering offset
  const body = new THREE.Group(); lift.add(body);

  // tapered torso (lathe) + chrome waist + glowing core
  const torsoPts = [[0.0, 0.62], [0.2, 0.64], [0.29, 0.75], [0.36, 0.98], [0.4, 1.25], [0.37, 1.42], [0.24, 1.5], [0.0, 1.52]].map(([x, y]) => new THREE.Vector2(x, y));
  const torso = new THREE.Mesh(new THREE.LatheGeometry(torsoPts, 40), shell); torso.castShadow = true; body.add(torso);
  const waist = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 12, 40), chrome); waist.rotation.x = Math.PI / 2; waist.position.y = 0.8; body.add(waist);
  for (const y of [0.98, 1.2]) { const seam = new THREE.Mesh(new THREE.TorusGeometry(y === 0.98 ? 0.362 : 0.398, 0.007, 6, 48), glow(c, 3)); seam.rotation.x = Math.PI / 2; seam.position.y = y; body.add(seam); }
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), glow(c, 4)); core.position.set(0, 1.12, 0.38); body.add(core);
  const coreRing = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 8, 32), chrome); coreRing.position.copy(core.position); body.add(coreRing);
  // shoulder armor
  for (const sx of [-1, 1]) {
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), accent);
    pad.position.set(sx * 0.42, 1.38, 0); pad.rotation.z = -sx * 0.4; pad.castShadow = true; body.add(pad);
  }
  // neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.14, 16), chrome); neck.position.y = 1.58; body.add(neck);

  // head: sleek elongated helmet with wraparound visor band
  const head = new THREE.Group(); head.position.y = 1.82; body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.25, 40, 28), shell); skull.scale.set(1.0, 1.08, 1.12); skull.castShadow = true; head.add(skull);
  const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.262, 0.255, 0.11, 40, 1, true, -1.25, 2.5), new THREE.MeshPhysicalMaterial({ color: 0x04050a, metalness: 1, roughness: 0.05, clearcoat: 1, side: THREE.DoubleSide }));
  visor.scale.set(1, 1, 1.12); visor.position.y = 0.01; head.add(visor);
  // visor light bar acts as "eyes" (scale.y used for blinking)
  const eyes = [];
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.266, 0.266, 0.022, 40, 1, true, -0.75, 1.5), glow(c, 5));
  bar.scale.set(1, 1, 1.12); bar.position.y = 0.01; head.add(bar); eyes.push(bar);
  // side fins / ear modules
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 24), chrome); ear.rotation.z = Math.PI / 2; ear.position.set(sx * 0.255, 0, -0.02); head.add(ear);
    const earGlow = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 24), glow(c, 3)); earGlow.rotation.y = Math.PI / 2; earGlow.position.set(sx * 0.285, 0, -0.02); head.add(earGlow);
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.22, 4), accent); fin.position.set(sx * 0.25, 0.14, -0.08); fin.rotation.set(-0.6, 0, -sx * 0.5); head.add(fin);
  }
  // crest light (status indicator, was the antenna ball)
  const crest = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.34), chrome); crest.position.set(0, 0.26, -0.02); head.add(crest);
  const antBall = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), glow(c, 3)); antBall.position.set(0, 0.29, 0.12); head.add(antBall);
  if (isBoss) {
    const crown = new THREE.Group(); crown.position.y = 0.42; head.add(crown);
    const cr = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.012, 8, 48), glow(NEON.gold, 3)); cr.rotation.x = Math.PI / 2; crown.add(cr);
    for (let k = 0; k < 6; k++) { const sh = new THREE.Mesh(new THREE.OctahedronGeometry(0.035), glow(NEON.gold, 4)); const a = k / 6 * Math.PI * 2; sh.position.set(Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22); crown.add(sh); }
    updaters.push(t => { crown.rotation.y = t * 0.8; crown.position.y = 0.42 + Math.sin(t * 2) * 0.02; });
    // cape-like energy wings
    for (const sx of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.9), additive(NEON.gold, 0.18));
      wing.position.set(sx * 0.35, 1.15, -0.32); wing.rotation.set(0.1, sx * 0.7, sx * 0.25); body.add(wing);
    }
  }

  // segmented arms with glowing joints and claw hands
  const arm = side => {
    const g = new THREE.Group();
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.2, 6, 12), chrome); upper.position.y = -0.17; g.add(upper);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 12), glow(c, 2.5)); elbow.position.y = -0.34; g.add(elbow);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.2, 6, 12), shell); fore.position.y = -0.52; g.add(fore);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 6, 24), accent); cuff.rotation.x = Math.PI / 2; cuff.position.y = -0.62; g.add(cuff);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), chrome); hand.scale.set(0.9, 1.2, 0.7); hand.position.y = -0.72; g.add(hand);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.position.set(side * 0.47, 1.36, 0);
    return g;
  };
  const armL = arm(-1), armR = arm(1); body.add(armL, armR);

  // hover thrusters instead of legs (legL / legR keep the same API for the walk cycle)
  const thruster = side => {
    const g = new THREE.Group(); g.position.set(side * 0.16, 0.66, 0);
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.22, 6, 12), shell); pod.position.y = -0.18; pod.castShadow = true; g.add(pod);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.07, 16), chrome); nozzle.position.y = -0.34; g.add(nozzle);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.35, 16, 1, true), additive(c, 0.7)); flame.rotation.x = Math.PI; flame.position.y = -0.55; g.add(flame);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.01, 6, 24), glow(c, 4)); ring.rotation.x = Math.PI / 2; ring.position.y = -0.38; g.add(ring);
    g.userData.flame = flame;
    return g;
  };
  const legL = thruster(-1), legR = thruster(1); lift.add(legL, legR);
  updaters.push(t => { for (const l of [legL, legR]) { const f = l.userData.flame; f.scale.y = 0.8 + Math.random() * 0.4; f.material.opacity = 0.45 + Math.random() * 0.3; } lift.position.y = 0.28 + Math.sin(t * 1.8 + c.r * 10) * 0.04; });

  // thinking ring (orbiting holo arc)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.014, 8, 48, Math.PI * 1.4), glow(0xffd54f, 3));
  ring.rotation.x = Math.PI / 2; ring.position.y = 2.72; ring.visible = false; R.add(ring);
  // status halo + hover glow on the floor
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.58, 64), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.rotation.x = -Math.PI / 2; halo.position.y = 0.02; R.add(halo);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(0.4, 32), additive(c, 0.18)); pool.rotation.x = -Math.PI / 2; pool.position.y = 0.015; R.add(pool);

  R.userData = { body, head, eyes, antBall, armL, armR, legL, legR, ring, halo, color: c };
  return R;
}

// ──────────────────────────────────────────────────────────── agent registry
const agents = {};          // id -> { info, robot, desk, label, bubble, state, ... }
const clickables = [];
const STATE_COLORS = { idle: 0x6b7280, thinking: 0xffd54f, working: 0x4ade80, tool: 0x4ade80, waiting: 0xff5a5f, error: 0xff5a5f, done: 0x4ade80 };

function spawnAgents(list) {
  for (const info of list) {
    if (agents[info.id]) continue;
    const L = LAYOUT[info.id] || { desk: [(Math.random() - .5) * 16, (Math.random() - .5) * 12], deskRot: 0 };
    const robot = makeRobot(info.color, info.id === 'orchestrator');
    let desk = null, home, faceAngle;
    if (L.desk) {
      desk = makeDesk(info.color, L.desk[0], L.desk[1], L.deskRot);
      // stand in front of the desk (on the side facing the room) looking at the screen
      const off = new THREE.Vector3(0, 0, 1.15).applyAxisAngle(new THREE.Vector3(0, 1, 0), L.deskRot);
      home = new THREE.Vector3(L.desk[0] + off.x, 0, L.desk[1] + off.z);
      faceAngle = L.deskRot + Math.PI;
    } else {
      home = new THREE.Vector3(L.home[0], 0, L.home[1]);
      faceAngle = 0; // face the entrance / visitor
    }
    robot.position.copy(home); robot.rotation.y = faceAngle;
    scene.add(robot);

    const labelEl = document.createElement('div');
    labelEl.className = 'label3d';
    labelEl.innerHTML = `<span style="color:${info.color}">●</span> ${info.name}<small>${info.role} · ${info.model}</small>`;
    const label = new CSS2DObject(labelEl); label.position.set(0, 2.95, 0); robot.add(label);

    const bubbleEl = document.createElement('div'); bubbleEl.className = 'bubble'; bubbleEl.style.opacity = 0;
    const bubble = new CSS2DObject(bubbleEl); bubble.position.set(0, 3.45, 0); robot.add(bubble);

    robot.traverse(o => { if (o.isMesh) { o.userData.agentId = info.id; clickables.push(o); } });
    agents[info.id] = {
      info, robot, desk, home, homeAngle: faceAngle, label, bubbleEl, bubbleTimer: 0,
      state: 'idle', detail: '', path: [], phase: Math.random() * 10, tool: '',
    };
    if (desk) drawScreen(agents[info.id]);
  }
  renderTeamPanel();
}

function drawScreen(a) {
  const { ctx, c, tex } = a.desk.screen;
  ctx.fillStyle = '#060912'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = a.info.color; ctx.fillRect(0, 0, c.width, 30);
  ctx.fillStyle = '#060912'; ctx.font = '600 16px Inter, sans-serif';
  ctx.fillText(`${a.info.name} · ${a.state.toUpperCase()}${a.tool ? ' · ' + a.tool : ''}`, 10, 21);
  if (a.state === 'idle') {
    ctx.fillStyle = '#2a3350'; ctx.font = '600 44px Inter, sans-serif'; ctx.fillText('◆', 230, 170);
    ctx.font = '14px Inter'; ctx.fillStyle = '#4a5578'; ctx.fillText('standing by', 216, 210);
  } else {
    ctx.font = '15px "JetBrains Mono", monospace';
    const lines = a.desk.lines;
    const start = Math.max(0, lines.length - 14);
    for (let i = start; i < lines.length; i++) {
      ctx.fillStyle = lines[i].c; ctx.fillText(lines[i].t.slice(0, 54), 12, 52 + (i - start) * 17.5);
    }
  }
  tex.needsUpdate = true;
}
const CODE_SNIPS = ['const plan = await think(task);', 'for (const step of plan) {', '  await exec(step);', '}', 'git checkout -b feature/agent', 'def solve(problem):', '    return analyse(problem)', 'import { Agent } from "./team";', '// TODO: verify result', 'npm test -- --watch=false', '✓ 12 passing', 'POST /repos/:owner/:repo/pulls', 'await graph.ainvoke(state)', 'if (ok) commit(changes);'];
function pushScreenLine(a, text, color) {
  if (!a.desk) return;
  for (const t of String(text).split('\n').slice(0, 6)) a.desk.lines.push({ t, c: color || '#9ecbff' });
  a.desk.lines = a.desk.lines.slice(-40);
}

// ──────────────────────────────────────────────────────────── speech & effects
function say(id, text, kind = '') {
  const a = agents[id]; if (!a) return;
  a.bubbleEl.className = 'bubble ' + kind;
  a.bubbleEl.textContent = text.length > 180 ? text.slice(0, 177) + '…' : text;
  a.bubbleEl.style.opacity = 1;
  a.bubbleTimer = 5 + Math.min(text.length / 40, 6);
}

const orbs = [];
function flyOrb(fromId, toId, color) {
  const A = agents[fromId], B = agents[toId]; if (!A || !B) return;
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), glow(new THREE.Color(color), 5));
  const light = new THREE.PointLight(color, 4, 4); m.add(light);
  scene.add(m);
  orbs.push({ m, from: A.robot.position.clone().setY(1.7), to: B.robot.position.clone().setY(1.7), t: 0 });
}

function walkTo(id, target, then) {
  const a = agents[id]; if (!a) return;
  a.path = [{ pos: target.clone(), then }];
}

// ──────────────────────────────────────────────────────────── state changes
function setState(id, state, detail) {
  const a = agents[id]; if (!a) return;
  a.state = state; a.detail = detail || '';
  if (state === 'tool') a.tool = detail;
  if (state === 'idle') a.tool = '';
  const col = STATE_COLORS[state] ?? 0x6b7280;
  a.robot.userData.halo.material.color.setHex(state === 'idle' ? a.robot.userData.color.getHex() : col);
  a.robot.userData.ring.visible = state === 'thinking';
  if (state === 'waiting') say(id, '⚠ ' + (detail || 'Waiting for your approval'), 'wait');
  if (state === 'thinking' && id !== 'orchestrator' && a.bubbleTimer <= 0) say(id, '…', 'think');
  if (a.desk) {
    if (state === 'thinking') pushScreenLine(a, '> thinking…', '#ffd54f');
    if (state === 'working' && detail) pushScreenLine(a, '> ' + detail.slice(0, 120), '#cfd6e6');
    drawScreen(a);
  }
  renderTeamPanel();
}

// ──────────────────────────────────────────────────────────── controls
const keys = {};
let yaw = 0, pitch = -0.08, dragging = false, dragMoved = 0, lastX = 0, lastY = 0, camTween = null;
addEventListener('keydown', e => {
  if (document.activeElement === input) { if (e.key === 'Escape') input.blur(); return; }
  keys[e.code] = true;
  if (e.code === 'KeyT' || e.code === 'Enter') { e.preventDefault(); input.focus(); }
});
addEventListener('keyup', e => { keys[e.code] = false; });
renderer.domElement.addEventListener('pointerdown', e => { dragging = true; dragMoved = 0; lastX = e.clientX; lastY = e.clientY; });
addEventListener('pointerup', e => {
  if (dragging && dragMoved < 5 && e.target === renderer.domElement) pick(e);
  dragging = false;
});
addEventListener('pointermove', e => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY; dragMoved += Math.abs(dx) + Math.abs(dy);
  lastX = e.clientX; lastY = e.clientY;
  yaw -= dx * 0.004; pitch = THREE.MathUtils.clamp(pitch - dy * 0.003, -1.2, 1.0); camTween = null;
});
renderer.domElement.addEventListener('wheel', e => {
  const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  camera.position.addScaledVector(f, -e.deltaY * 0.01); clampCam(); camTween = null;
}, { passive: true });

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(clickables, false)[0];
  if (hit) selectAgent(hit.object.userData.agentId, true);
}
function clampCam() {
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -ROOM.w / 2 + 0.8, ROOM.w / 2 - 0.8);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, -ROOM.d / 2 + 0.8, ROOM.d / 2 - 0.8);
  camera.position.y = 1.7;
}
function lookAtAgent(id) {
  const a = agents[id]; if (!a) return;
  const p = a.robot.position, h = a.homeAngle;
  // three-quarter front view: for desk agents swing to whichever side keeps us inside the room
  // desk agents: over-the-shoulder so you see them and their holo-screen; Atlas: from the front
  const views = a.desk ? [h + Math.PI + 0.5, h + Math.PI - 0.5] : [h];
  let dest = null;
  for (const ang of views) {
    const dist = a.desk ? 3.6 : 3.3;
    const c = new THREE.Vector3(p.x + Math.sin(ang) * dist, 1.7, p.z + Math.cos(ang) * dist);
    if (!dest || c.x * c.x + c.z * c.z < dest.x * dest.x + dest.z * dest.z) dest = c;
  }
  const look = new THREE.Vector3(p.x, 0, p.z);
  if (a.desk) look.add(new THREE.Vector3(Math.sin(h), 0, Math.cos(h)).multiplyScalar(1.2)); // agent + screen in frame
  const d = new THREE.Vector3().subVectors(look, dest);
  camTween = { pos: dest, yaw: Math.atan2(-d.x, -d.z), pitch: -0.08 };
}

// ──────────────────────────────────────────────────────────── UI
const $ = s => document.querySelector(s);
const input = $('#task-input'), feed = $('#feed'), chip = $('#target-chip');
let target = null, info = null, busy = false;

function selectAgent(id, fly) {
  target = (id === 'orchestrator' || id === target) ? null : id;
  const a = target && agents[target];
  chip.textContent = a ? `To: ${a.info.name} (${a.info.role})` : 'To: Atlas (team)';
  chip.style.borderColor = a ? a.info.color : '';
  if (fly) lookAtAgent(id);
  renderTeamPanel();
  input.focus();
}
chip.onclick = () => selectAgent('orchestrator', true);

function renderTeamPanel() {
  $('#team').innerHTML = Object.values(agents).map(a => `
    <div class="agent-row ${target === a.info.id ? 'sel' : ''}" data-id="${a.info.id}">
      <span class="agent-dot" style="color:${a.info.color};background:${a.info.color}"></span>
      <div class="agent-meta"><div class="agent-name">${a.info.name}</div><div class="agent-role">${a.info.role} · ${a.info.model}</div></div>
      <span class="agent-state ${a.state}">${a.state}</span>
    </div>`).join('');
  document.querySelectorAll('.agent-row').forEach(r => r.onclick = () => selectAgent(r.dataset.id, true));
}

function nameOf(id) { return id === 'human' ? 'You' : agents[id]?.info.name || id; }
function colorOf(id) { return id === 'human' ? '#ffffff' : agents[id]?.info.color || '#aaa'; }
function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function addFeed(html, cls = '') {
  const d = document.createElement('div'); d.className = 'ev ' + cls; d.innerHTML = html;
  feed.appendChild(d); feed.scrollTop = feed.scrollHeight;
  while (feed.children.length > 250) feed.firstChild.remove();
}
function boardLine(text, color) { boardState.lines.push({ text, color }); boardState.lines = boardState.lines.slice(-30); drawBoard(); }
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.add('hidden'), 5000); }
function setBusy(b) { busy = b; $('#stop-btn').classList.toggle('hidden', !b); }

$('#composer').onsubmit = e => {
  e.preventDefault();
  const text = input.value.trim(); if (!text || !ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'task', text, target }));
  input.value = '';
};
$('#stop-btn').onclick = () => ws?.send(JSON.stringify({ type: 'stop' }));
$('#report-close').onclick = () => $('#report').classList.add('hidden');
$('#enter-btn').onclick = () => {
  $('#enter').classList.add('hidden'); $('#hud').classList.remove('hidden');
  camTween = { pos: new THREE.Vector3(0, 1.7, 9.5), yaw: 0, pitch: -0.1 };
  setTimeout(() => input.focus(), 600);
};

// approvals (queue, one at a time)
const approvals = [];
function showApproval() {
  const ap = approvals[0];
  if (!ap) { $('#approval').classList.add('hidden'); return; }
  $('#ap-title').textContent = `${nameOf(ap.agent)} wants to: ${ap.action}`;
  $('#ap-detail').textContent = ap.detail;
  $('#approval').classList.remove('hidden');
  lookAtAgent(ap.agent);
}
function answer(ok) { const ap = approvals.shift(); if (ap) ws.send(JSON.stringify({ type: 'approval', id: ap.id, approved: ok })); showApproval(); }
$('#ap-ok').onclick = () => answer(true);
$('#ap-deny').onclick = () => answer(false);

// ──────────────────────────────────────────────────────────── websocket
let ws;
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onmessage = ev => handle(JSON.parse(ev.data));
  ws.onclose = () => setTimeout(connect, 1500);
}
function handle(m) {
  switch (m.type) {
    case 'hello': {
      info = m.info; spawnAgents(info.agents); setBusy(info.busy);
      const chips = [
        ['ChatGPT', info.providers.includes('openai')], ['GLM', info.providers.includes('glm')],
        ['GitHub', info.github], [info.approval ? 'Approvals ON' : 'Approvals OFF', info.approval],
      ];
      $('#status-chips').innerHTML = chips.map(([n, on]) => `<span class="chip ${on ? 'on' : 'off'}">${on ? '✓' : '✗'} ${n}</span>`).join('');
      if (!info.providers.length) toast('No API keys found – add OPENAI_API_KEY and/or GLM_API_KEY to .env and restart the server.');
      break;
    }
    case 'agent_status': setState(m.agent, m.state, m.detail); break;
    case 'message': {
      const toTxt = m.to ? ` <span class="arrow">→ ${esc(nameOf(m.to))}</span>` : '';
      addFeed(`<span class="who" style="color:${colorOf(m.agent)}">${esc(nameOf(m.agent))}</span>${toTxt}<div class="txt">${esc(m.text.length > 1200 ? m.text.slice(0, 1200) + '…' : m.text)}</div>`);
      if (m.agent !== 'human') { say(m.agent, m.text); boardLine(`${nameOf(m.agent)}: ${m.text.replace(/\s+/g, ' ')}`, colorOf(m.agent)); }
      break;
    }
    case 'delegate': {
      const a = agents[m.to];
      flyOrb(m.frm, m.to, colorOf(m.frm));
      if (m.frm === 'orchestrator' && a && a.desk) {
        // worker walks over to the holo table to get the brief, then returns to their desk
        const brief = new THREE.Vector3().copy(a.home).multiplyScalar(0.45);
        walkTo(m.to, brief, () => setTimeout(() => walkTo(m.to, a.home, () => { a.robot.userData.arrived = true; }), 900));
        addFeed(`<span class="who" style="color:${colorOf('orchestrator')}">Atlas</span> <span class="arrow">delegates to</span> <span class="who" style="color:${colorOf(m.to)}">${esc(nameOf(m.to))}</span><div class="txt">${esc(m.instruction)}</div>`);
        boardLine(`→ ${nameOf(m.to)}: ${m.instruction.replace(/\s+/g, ' ')}`, colorOf(m.to));
        pushScreenLine(a, '# NEW ASSIGNMENT', '#f5c542'); pushScreenLine(a, m.instruction.slice(0, 160), '#cfd6e6');
      }
      break;
    }
    case 'tool_call': {
      addFeed(`⚙ <b style="color:${colorOf(m.agent)}">${esc(nameOf(m.agent))}</b> → <b>${esc(m.tool)}</b> ${esc(m.input.slice(0, 220))}`, 'tool');
      const a = agents[m.agent]; if (a) { pushScreenLine(a, `$ ${m.tool}(${m.input.slice(0, 80)})`, '#9ecbff'); drawScreen(a); }
      break;
    }
    case 'tool_result': {
      const a = agents[m.agent]; if (a) { pushScreenLine(a, m.output.slice(0, 300), '#7f8aa3'); drawScreen(a); }
      break;
    }
    case 'task_started':
      setBusy(true); boardState.task = m.task; boardState.lines = []; drawBoard();
      addFeed(`▶ New task${m.target ? ' for ' + esc(nameOf(m.target)) : ''}`, 'sys');
      break;
    case 'task_done':
      setBusy(false); boardLine('✓ Task complete', '#4ade80');
      $('#report-body').innerHTML = window.marked ? marked.parse(m.report) : esc(m.report);
      $('#report').classList.remove('hidden');
      addFeed(`<span class="who" style="color:${colorOf('orchestrator')}">Atlas · final report</span><div class="txt">${esc(m.report)}</div>`);
      say('orchestrator', 'Done! Report is up.');
      break;
    case 'task_error':
      setBusy(false); boardLine('✗ ' + m.error, '#ff5a5f'); addFeed('✗ ' + esc(m.error), 'sys'); toast(m.error);
      approvals.length = 0; showApproval();
      break;
    case 'approval_request': approvals.push(m); if (approvals.length === 1) showApproval(); break;
    case 'approval_closed': {
      const i = approvals.findIndex(a => a.id === m.id);
      if (i >= 0) { approvals.splice(i, 1); showApproval(); }
      break;
    }
    case 'notice': toast(m.text); addFeed(esc(m.text), 'sys'); break;
  }
}
connect();
window.__room = { // debugging hook (used for screenshots)
  handle, agents, camera,
  snap(id) { if (id) lookAtAgent(id); if (camTween) { camera.position.copy(camTween.pos); yaw = camTween.yaw; pitch = camTween.pitch; camTween = null; } },
  view(x, z, y, p) { camTween = null; camera.position.set(x, 1.7, z); yaw = y; pitch = p; },
};

// ──────────────────────────────────────────────────────────── animation loop
const clock = new THREE.Clock();
let screenTick = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;

  // camera movement
  const speed = (keys.ShiftLeft ? 9 : 4.5) * dt;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), rgt = new THREE.Vector3(-fwd.z, 0, fwd.x);
  if (keys.KeyW || keys.ArrowUp) camera.position.addScaledVector(fwd, speed);
  if (keys.KeyS || keys.ArrowDown) camera.position.addScaledVector(fwd, -speed);
  if (keys.KeyA || keys.ArrowLeft) camera.position.addScaledVector(rgt, -speed);
  if (keys.KeyD || keys.ArrowRight) camera.position.addScaledVector(rgt, speed);
  if (Object.values(keys).some(Boolean)) camTween = null;
  if (camTween) {
    camera.position.lerp(camTween.pos, 1 - Math.pow(0.02, dt));
    let dy = camTween.yaw - yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    yaw += dy * (1 - Math.pow(0.02, dt)); pitch += (camTween.pitch - pitch) * (1 - Math.pow(0.02, dt));
    if (camera.position.distanceTo(camTween.pos) < 0.02 && Math.abs(dy) < 0.002) camTween = null;
  }
  clampCam();
  camera.rotation.set(pitch, yaw, 0, 'YXZ');

  for (const f of updaters) f(t, dt);
  holo.userData.globe.rotation.y += dt * 0.6;
  holo.userData.globe.rotation.x = Math.sin(t * 0.4) * 0.2;

  // agents
  for (const a of Object.values(agents)) {
    const u = a.robot.userData; a.phase += dt;
    let walking = false;
    if (a.path.length) {
      const step = a.path[0], to = step.pos, p = a.robot.position;
      const d = new THREE.Vector3(to.x - p.x, 0, to.z - p.z), dist = d.length();
      if (dist < 0.06) { a.path.shift(); step.then?.(); }
      else {
        walking = true; d.normalize();
        p.addScaledVector(d, Math.min(dist, 2.6 * dt));
        const ang = Math.atan2(d.x, d.z);
        let da = ang - a.robot.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da));
        a.robot.rotation.y += da * Math.min(1, dt * 10);
      }
    }
    if (!walking) {
      // face the desk/visitor when standing at home
      const atHome = a.robot.position.distanceTo(a.home) < 0.1;
      const want = atHome ? a.homeAngle : a.robot.rotation.y;
      let da = want - a.robot.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da));
      a.robot.rotation.y += da * Math.min(1, dt * 5);
    }

    const busyish = a.state === 'working' || a.state === 'tool';
    if (walking) {
      const s = Math.sin(a.phase * 11);
      u.legL.rotation.x = s * 0.6; u.legR.rotation.x = -s * 0.6;
      u.armL.rotation.x = -s * 0.5; u.armR.rotation.x = s * 0.5;
      u.body.position.y = Math.abs(Math.cos(a.phase * 11)) * 0.05;
    } else {
      u.legL.rotation.x *= 0.8; u.legR.rotation.x *= 0.8;
      if (busyish && a.desk) { // typing
        u.armL.rotation.x = -1.15 + Math.sin(a.phase * 22) * 0.12;
        u.armR.rotation.x = -1.15 + Math.sin(a.phase * 22 + 1.7) * 0.12;
        u.head.rotation.x = 0.12; u.head.rotation.y = Math.sin(a.phase * 0.8) * 0.15;
      } else if (a.state === 'thinking') {
        u.armR.rotation.x = -2.0; u.armR.rotation.z = 0.5; u.armL.rotation.x *= 0.85; // hand on chin
        u.head.rotation.z = Math.sin(a.phase * 1.5) * 0.15; u.head.rotation.x = -0.1;
      } else if (a.state === 'waiting') {
        u.armR.rotation.x = -2.8 + Math.sin(a.phase * 6) * 0.2; u.armR.rotation.z = 0; // waving
        u.armL.rotation.x *= 0.85;
      } else if (a.info.id === 'orchestrator' || busyish) {
        u.armL.rotation.x = -0.6 + Math.sin(a.phase * 2) * 0.1; u.armR.rotation.x = -0.6 + Math.cos(a.phase * 2) * 0.1;
        u.armR.rotation.z *= 0.85; u.head.rotation.z *= 0.9;
      } else { // idle
        u.armL.rotation.x *= 0.9; u.armR.rotation.x *= 0.9; u.armR.rotation.z *= 0.9;
        u.head.rotation.y = Math.sin(a.phase * 0.5) * 0.35; u.head.rotation.x *= 0.9; u.head.rotation.z *= 0.9;
      }
      u.body.position.y = Math.sin(a.phase * 2) * 0.015;
    }
    u.ring.rotation.z += dt * 4;
    const pulse = a.state === 'waiting' || a.state === 'error' ? 2 + Math.sin(t * 10) * 2 : a.state === 'idle' ? 1.5 : 3 + Math.sin(t * 5);
    u.antBall.material.emissiveIntensity = Math.max(0.3, pulse);
    if (a.state === 'waiting' || a.state === 'error') u.antBall.material.emissive.setHex(0xff3b3b);
    else if (a.state === 'thinking') u.antBall.material.emissive.setHex(0xffd54f);
    else u.antBall.material.emissive.copy(u.color);
    // blink
    const blink = (a.phase % 4) < 0.12 ? 0.1 : 1; u.eyes.forEach(e => e.scale.y = blink);
    u.halo.material.opacity = 0.25 + (a.state === 'idle' ? 0 : 0.25 + Math.sin(t * 4) * 0.15);

    if (a.bubbleTimer > 0) { a.bubbleTimer -= dt; if (a.bubbleTimer <= 0) a.bubbleEl.style.opacity = 0; }
  }

  // ambient "code" on busy screens
  screenTick += dt;
  if (screenTick > 0.35) {
    screenTick = 0;
    for (const a of Object.values(agents)) if (a.desk && (a.state === 'working' || a.state === 'tool' || a.state === 'thinking')) {
      if (Math.random() < 0.5) pushScreenLine(a, CODE_SNIPS[(Math.random() * CODE_SNIPS.length) | 0], ['#66bb6a', '#4fc3f7', '#cfd6e6', '#ab47bc'][(Math.random() * 4) | 0]);
      drawScreen(a);
    }
  }

  // delegation orbs
  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i]; o.t += dt * 0.9;
    const p = new THREE.Vector3().lerpVectors(o.from, o.to, o.t); p.y += Math.sin(o.t * Math.PI) * 1.6;
    o.m.position.copy(p);
    if (o.t >= 1) { scene.remove(o.m); orbs.splice(i, 1); }
  }

  composer.render();
  labelRenderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); labelRenderer.setSize(innerWidth, innerHeight);
});
