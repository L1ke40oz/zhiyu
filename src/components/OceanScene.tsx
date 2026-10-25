import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Course } from '../../shared/types';
import { createLandscape, outline, seededRandom } from '../../shared/landscape';
import { roofColors } from '../island-config';
import { oceanLayout, type OceanLayout } from '../../shared/ocean-layout';

type Props = { courses: Course[]; reducedMotion: boolean; layout: OceanLayout | null; onReady?: () => void };
function makeResources() {
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  function mesh(geometry: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0) {
    let material = materials.get(color);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
      materials.set(color, material);
    }
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z);
    object.castShadow = true;
    object.receiveShadow = true;
    return object;
  }
  return { mesh };
}
type Resources = ReturnType<typeof makeResources>;
function cottage(resources: Resources, roof: string, scale: number, complete = false) {
  const { mesh } = resources,
    group = new THREE.Group();
  group.add(mesh(new THREE.BoxGeometry(0.65, 0.64, 0.58), '#fff0d1', 0, 0.48, 0));
  const triangle = new THREE.Shape();
  triangle.moveTo(-0.43, 0);
  triangle.lineTo(0, 0.41);
  triangle.lineTo(0.43, 0);
  triangle.closePath();
  group.add(
    mesh(new THREE.ExtrudeGeometry(triangle, { depth: 0.76, bevelEnabled: false }), roof, 0, 0.8, -0.38),
  );
  group.add(mesh(new THREE.BoxGeometry(0.16, 0.29, 0.025), '#987959', 0, 0.31, 0.3));
  for (const x of [-0.21, 0.21]) {
    group.add(mesh(new THREE.BoxGeometry(0.14, 0.17, 0.03), '#d8bd8a', x, 0.55, 0.3));
    group.add(
      mesh(new THREE.BoxGeometry(0.1, 0.125, 0.035), complete ? '#ffe1a0' : '#b6d1bc', x, 0.55, 0.31),
    );
  }
  group.add(mesh(new THREE.BoxGeometry(0.11, 0.24, 0.12), '#f6e5c5', 0.2, 1.02, -0.1));
  group.scale.setScalar(scale);
  return group;
}
function plant(resources: Resources, kind: string, scale: number, tint = 0) {
  const { mesh } = resources,
    group = new THREE.Group();
  if (kind === 'rock') group.add(mesh(new THREE.DodecahedronGeometry(0.14, 0), '#acb9ae', 0, 0.15));
  else if (kind === 'flower') {
    group.add(mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.18, 5), '#729969', 0, 0.17));
    for (let i = 0; i < 5; i++) {
      const angle = (i * Math.PI * 2) / 5;
      group.add(
        mesh(
          new THREE.IcosahedronGeometry(0.065, 0),
          tint > 0.5 ? '#e9c38d' : '#d8b5c9',
          Math.cos(angle) * 0.055,
          0.28,
          Math.sin(angle) * 0.055,
        ),
      );
    }
    group.add(mesh(new THREE.IcosahedronGeometry(0.035, 0), '#f6db83', 0, 0.3));
  } else if (kind === 'bush') {
    group.add(mesh(new THREE.IcosahedronGeometry(0.17, 0), '#99b66d', 0, 0.21));
    group.add(mesh(new THREE.IcosahedronGeometry(0.12, 0), '#acc481', 0.12, 0.18, 0.03));
  } else {
    group.add(mesh(new THREE.CylinderGeometry(0.045, 0.065, 0.47, 5), '#a58c60', 0, 0.31));
    if (kind === 'pine') {
      group.add(mesh(new THREE.ConeGeometry(0.3, 0.63, 7), tint > 0.5 ? '#7fa16b' : '#759a72', 0, 0.84));
      group.add(mesh(new THREE.ConeGeometry(0.35, 0.6, 7), '#88a973', 0, 0.59));
    } else {
      group.add(mesh(new THREE.IcosahedronGeometry(0.33, 0), tint > 0.5 ? '#a3bf7b' : '#8faf77', 0, 0.73));
      group.add(mesh(new THREE.IcosahedronGeometry(0.23, 0), '#b3ca8c', 0.13, 0.81, 0.025));
    }
  }
  group.scale.setScalar(scale);
  return group;
}
function lighthouse(resources: Resources) {
  const { mesh } = resources,
    group = new THREE.Group();
  group.add(mesh(new THREE.CylinderGeometry(0.36, 0.43, 0.13, 12), '#d5c79e', 0, 0.17));
  group.add(mesh(new THREE.CylinderGeometry(0.21, 0.29, 1.22, 12), '#fff4d7', 0, 0.83));
  group.add(mesh(new THREE.CylinderGeometry(0.234, 0.248, 0.19, 12), '#d98e76', 0, 0.96));
  group.add(mesh(new THREE.CylinderGeometry(0.254, 0.27, 0.16, 12), '#d98e76', 0, 0.52));
  group.add(mesh(new THREE.BoxGeometry(0.15, 0.27, 0.03), '#8a795b', 0, 0.32, 0.29));
  for (const y of [0.65, 1.18])
    group.add(mesh(new THREE.BoxGeometry(0.075, 0.13, 0.025), '#a0c8bd', 0.08, y, 0.235));
  group.add(mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.075, 12), '#6a9689', 0, 1.47));
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.21, 0.21, 0.29, 10),
    new THREE.MeshStandardMaterial({
      color: '#e4ead0',
      emissive: '#f4cd79',
      emissiveIntensity: 0.65,
      transparent: true,
      opacity: 0.85,
    }),
  );
  glass.position.y = 1.65;
  group.add(glass);
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    group.add(
      mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 0.3, 5),
        '#6c8d7b',
        Math.cos(angle) * 0.22,
        1.66,
        Math.sin(angle) * 0.22,
      ),
    );
  }
  group.add(mesh(new THREE.ConeGeometry(0.37, 0.25, 12), '#679485', 0, 1.93));
  group.add(mesh(new THREE.IcosahedronGeometry(0.065, 0), '#d6bd7a', 0, 2.1));
  const beamPivot = new THREE.Group();
  beamPivot.position.y = 1.66;
  const beamGeometry = new THREE.ConeGeometry(0.65, 2.8, 20, 1, true);
  beamGeometry.rotateZ(Math.PI / 2);
  beamGeometry.translate(1.4, 0, 0);
  const beam = new THREE.Mesh(
    beamGeometry,
    new THREE.MeshBasicMaterial({
      color: '#fff0b5',
      transparent: true,
      opacity: 0.065,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  beamPivot.add(beam);
  group.add(beamPivot);
  group.userData.beacon = beamPivot;
  return group;
}
function buildIsland(resources: Resources, course?: Course) {
  const { mesh } = resources,
    group = new THREE.Group(),
    type = course?.shape || 'bean';
  const shape = new THREE.Shape(outline(type).map((point) => new THREE.Vector2(point.x, -point.z)));
  const sand = mesh(
    new THREE.ExtrudeGeometry(shape, {
      depth: 0.2,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: 0.13,
      bevelThickness: 0.1,
      curveSegments: 5,
    }),
    '#edd8a7',
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = -0.19;
  group.add(sand);
  const grass = mesh(
    new THREE.ExtrudeGeometry(shape, {
      depth: 0.055,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: 0.06,
      bevelThickness: 0.06,
      curveSegments: 5,
    }),
    course
      ? { apricot: '#b6c984', sage: '#a9c78c', lilac: '#aabf9a', sky: '#a3c5a5' }[course.palette]
      : '#a9c189',
  );
  grass.rotation.x = -Math.PI / 2;
  grass.scale.setScalar(0.87);
  grass.position.y = 0.05;
  group.add(grass);
  const dockX = type === 'crescent' ? -0.87 : 0.8;
  for (let i = 0; i < 5; i++)
    group.add(
      mesh(
        new THREE.BoxGeometry(0.33, 0.04, 0.11),
        i % 2 ? '#b99870' : '#c7a47c',
        dockX,
        0.02,
        0.65 + i * 0.12,
      ),
    );
  for (const z of [0.64, 1.12])
    for (const x of [dockX - 0.19, dockX + 0.19])
      group.add(mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.23, 5), '#a28462', x, 0.04, z));
  if (!course) {
    const tower = lighthouse(resources);
    tower.position.set(-0.05, 0.04, -0.16);
    group.add(tower);
    group.userData.beacon = tower.userData.beacon;
    for (const [x, z, scale] of [
      [-0.8, -0.32, 0.64],
      [0.72, -0.28, 0.65],
      [-0.65, 0.46, 0.5],
    ]) {
      const shrub = plant(resources, 'bush', scale);
      shrub.position.set(x, 0.09, z);
      group.add(shrub);
    }
    for (const [x, z] of [
      [-1.05, 0.35],
      [0.87, 0.25],
      [-0.73, -0.65],
    ])
      group.add(mesh(new THREE.DodecahedronGeometry(0.17, 0), '#aeb8ae', x, 0.13, z));
    group.userData.phase = 0.8;
  } else {
    const layout = createLandscape(course.id, course.shape),
      random = seededRandom(course.id),
      roof = roofColors[course.palette];
    group.userData.phase = layout.phase;
    group.userData.theme = layout.theme;
    for (const element of layout.elements) {
      let object: THREE.Group | null = null;
      if (element.kind === 'growth') {
        const region = course.regions?.find((region) => region.groupIndex === element.region),
          level = region?.level || 0;
        if (layout.theme === 'woodland') {
          if (level >= 2) {
            object = plant(
              resources,
              element.region === 1 ? 'pine' : 'tree',
              element.scale * (level >= 3 ? 1.38 : 1.05),
              random(),
            );
          } else if (level === 1) object = plant(resources, 'bush', (0.85 * element.scale) / 0.4, random());
          else object = plant(resources, 'flower', (0.55 * element.scale) / 0.4, random());
        } else if (level >= 2) object = cottage(resources, roof, element.scale, level >= 3);
        else if (level === 1) {
          object = new THREE.Group();
          object.add(mesh(new THREE.BoxGeometry(0.34, 0.03, 0.24), '#d2bf99', 0, 0.06));
          for (const x of [-0.17, 0.17])
            object.add(mesh(new THREE.BoxGeometry(0.025, 0.3, 0.025), '#ad946f', x, 0.23, 0.1));
          object.add(mesh(new THREE.BoxGeometry(0.38, 0.025, 0.025), '#c4aa7e', 0, 0.39, 0.1));
          object.scale.setScalar(element.scale / 0.4);
        }
        if (region?.due) {
          const cloudMaterial = new THREE.MeshStandardMaterial({
            color: '#fff8e6',
            transparent: true,
            opacity: 0.48,
            depthWrite: false,
          });
          for (let i = 0; i < 3; i++) {
            const cloud = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17 + i * 0.02, 1), cloudMaterial);
            cloud.position.set(element.x - 0.13 + i * 0.12, 0.48 + i * 0.05, element.z);
            cloud.scale.y = 0.6;
            group.add(cloud);
          }
        }
      } else
        object =
          element.kind === 'house'
            ? cottage(resources, roof, element.scale)
            : plant(resources, element.kind, element.scale, random());
      if (object) {
        object.position.set(element.x, 0.1, element.z);
        object.rotation.y = element.rotation;
        group.add(object);
      }
    }
  }
  const shoreline = new THREE.ShapeGeometry(shape);
  const halo = new THREE.Mesh(
    shoreline,
    new THREE.MeshBasicMaterial({ color: '#d6f2de', transparent: true, opacity: 0.23, depthWrite: false }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.scale.setScalar(1.16);
  halo.position.y = -0.265;
  group.add(halo);
  group.userData.registry = !course;
  return group;
}
function makeWater() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      deep: { value: new THREE.Color('#80c9c5') },
      shallow: { value: new THREE.Color('#b1e2d4') },
    },
    vertexShader: `varying vec2 waterPosition;void main(){vec4 world=modelMatrix*vec4(position,1.0);waterPosition=world.xz;gl_Position=projectionMatrix*viewMatrix*world;}`,
    fragmentShader: `uniform float time;uniform vec3 deep;uniform vec3 shallow;varying vec2 waterPosition;
      void main(){vec2 p=waterPosition;float slow=sin(p.x*.11+p.y*.09+time*.05)*.5+.5;vec3 water=mix(deep,shallow,.44+slow*.28);
      float a=sin(p.x*.8+p.y*.31-time*.3+sin(p.y*.5+time*.13));float b=sin(p.y*.95-p.x*.24+time*.22+sin(p.x*.6-time*.11));
      float lace=pow(max(0.,1.-abs(a+b*.65)),19.);float ribbon=pow(max(0.,1.-abs(sin(p.x*.32+p.y*1.3-time*.2))),35.);
      water+=vec3(.075,.09,.065)*lace*.42;water+=vec3(.045,.06,.05)*ribbon*.32;
      gl_FragColor=vec4(water,1.);
      #include <colorspace_fragment>
      }`,
    depthWrite: false,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), material);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.31;
  return { water, material };
}
export default function OceanScene({ courses, reducedMotion, layout, onReady }: Props) {
  const container = useRef<HTMLDivElement>(null),
    ready = useRef(onReady);
  ready.current = onReady;
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const host = container.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      setUnavailable(true);
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(renderer.domElement);
    const resources = makeResources(),
      scene = new THREE.Scene(),
      camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
    camera.position.set(9, 15, 19);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.AmbientLight('#fff7e8', 1.7));
    const sun = new THREE.DirectionalLight('#fff2d7', 2.5);
    sun.position.set(-6, 14, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28 });
    sun.shadow.bias = -0.002;
    scene.add(sun);
    const water = makeWater();
    scene.add(water.water);
    const shadows = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ color: '#427e76', opacity: 0.13 }),
    );
    shadows.rotation.x = -Math.PI / 2;
    shadows.position.y = -0.29;
    shadows.receiveShadow = true;
    scene.add(shadows);
    const islands = [
      ...courses.map((course) => ({ group: buildIsland(resources, course), slot: course.slotId })),
      { group: buildIsland(resources), slot: -1 },
    ];
    islands.forEach((island) => scene.add(island.group));
    const ray = new THREE.Raycaster(),
      plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    function resize() {
      const width = host!.clientWidth,
        height = host!.clientHeight;
      if (!width || !height) return;
      const aspect = width / height;
      camera.left = -9 * aspect;
      camera.right = 9 * aspect;
      camera.top = 9;
      camera.bottom = -9;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, width > 1440 ? 1.25 : 1.6));
      renderer.setSize(width, height);
      const layout = oceanLayout(width, height);
      for (const island of islands) {
        const position = island.slot < 0 ? layout.registry : layout.courses[island.slot];
        ray.setFromCamera(
          new THREE.Vector2((position.x / width) * 2 - 1, 1 - (position.y / height) * 2),
          camera,
        );
        const point = new THREE.Vector3();
        ray.ray.intersectPlane(plane, point);
        island.group.position.copy(point);
        const target = position.size;
        island.group.scale.setScalar(target / ((height / 18) * 3.1));
        island.group.userData.baseY = point.y;
      }
      renderer.render(scene, camera);
      host!.dataset.ready = 'true';
    }
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    ready.current?.();
    let frame = 0,
      last = 0;
    function animate(time: number) {
      frame = requestAnimationFrame(animate);
      if (document.hidden || time - last < 33) return;
      last = time;
      const t = time * 0.001;
      water.material.uniforms.time.value = t;
      for (const island of islands) {
        island.group.position.y =
          island.group.userData.baseY +
          Math.sin(t * 0.8 + island.group.userData.phase) * 0.055 * island.group.scale.x;
        island.group.rotation.z = Math.sin(t * 0.55 + island.group.userData.phase) * 0.007;
        if (island.group.userData.beacon) island.group.userData.beacon.rotation.y = t * 0.21;
      }
      renderer.render(scene, camera);
    }
    if (!reducedMotion) frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      const geometries = new Set<THREE.BufferGeometry>(),
        materials = new Set<THREE.Material>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          geometries.add(object.geometry);
          for (const material of Array.isArray(object.material) ? object.material : [object.material])
            materials.add(material);
        }
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [courses, reducedMotion]);
  return (
    <div className="ocean-render" ref={container} aria-hidden="true">
      {unavailable ? (
        <div className="fallback-islands">
          {layout &&
            [...courses.map((course) => course.slotId), -1].map((slot, i) => (
              <span
                key={i}
                className="fallback-island"
                style={{
                  left: (slot < 0 ? layout.registry : layout.courses[slot]).x,
                  top: (slot < 0 ? layout.registry : layout.courses[slot]).y,
                  width: (slot < 0 ? layout.registry : layout.courses[slot]).size,
                  height: (slot < 0 ? layout.registry : layout.courses[slot]).size * 0.65,
                }}
              />
            ))}
        </div>
      ) : null}
    </div>
  );
}
