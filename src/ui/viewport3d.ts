// three.js scene: oriented model on a Z-up grid, orbit controls, axis gizmo.
import {
  AmbientLight, BufferAttribute, BufferGeometry, Box3, Box3Helper, CanvasTexture, Color,
  DirectionalLight, DoubleSide, GridHelper, Group, Line, LineBasicMaterial, Mesh as ThreeMesh,
  MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, Scene, Sprite, SpriteMaterial,
  Vector3, WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Mesh } from "../core/types";
import { bboxSize } from "../core/mesh";

const GIZMO_PX = 96;

function cssColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export class Viewport3D {
  private renderer: WebGLRenderer | null = null;
  private scene = new Scene();
  private camera = new PerspectiveCamera(40, 1, 0.1, 100000);
  private controls: OrbitControls | null = null;
  private modelGroup = new Group();
  private grid: GridHelper | null = null;
  private gizmoScene = new Scene();
  private gizmoCamera = new OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
  private raf = 0;
  private bounds: Box3 | null = null;
  private fitDim = 0;

  constructor(private container: HTMLElement) {
    this.camera.up.set(0, 0, 1); // Z is up: layers are horizontal
    this.camera.position.set(60, -80, 50);
    this.gizmoCamera.up.set(0, 0, 1);

    try {
      this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) {
      container.textContent = "WebGL is not available in this browser; the 3D view is disabled.";
      container.classList.add("novgl");
      return;
    }
    const r = this.renderer;
    r.setPixelRatio(window.devicePixelRatio || 1);
    r.autoClear = false;
    container.append(r.domElement);
    r.domElement.classList.add("gl");

    // Headlight so every face is lit from the viewer's side.
    this.scene.add(new AmbientLight(0xffffff, 0.9));
    const light = new DirectionalLight(0xffffff, 2.2);
    light.position.set(0.4, -0.6, 1);
    this.camera.add(light);
    this.scene.add(this.camera);
    this.scene.add(this.modelGroup);
    this.buildGizmo();

    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.addEventListener("change", () => this.requestRender());
    this.controls.screenSpacePanning = true;

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.setMesh(null);
  }

  private buildGizmo() {
    const mk = (dir: Vector3, color: number, label: string) => {
      const geo = new BufferGeometry().setFromPoints([new Vector3(), dir]);
      this.gizmoScene.add(new Line(geo, new LineBasicMaterial({ color })));
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d")!;
      g.fillStyle = "#" + color.toString(16).padStart(6, "0");
      g.font = "bold 44px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(label, 32, 34);
      const sp = new Sprite(new SpriteMaterial({ map: new CanvasTexture(c), depthTest: false }));
      sp.position.copy(dir).multiplyScalar(1.28);
      sp.scale.set(0.5, 0.5, 0.5);
      this.gizmoScene.add(sp);
    };
    mk(new Vector3(1, 0, 0), 0xe5484d, "X");
    mk(new Vector3(0, 1, 0), 0x30a46c, "Y");
    mk(new Vector3(0, 0, 1), 0x3e63dd, "Z");
  }

  /** Replace the displayed model. `mesh` must already be oriented (min Z = 0). */
  setMesh(mesh: Mesh | null, fit = false) {
    if (!this.renderer) return;
    for (const child of [...this.modelGroup.children]) {
      this.modelGroup.remove(child);
      const m = child as ThreeMesh;
      m.geometry?.dispose();
    }
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid = null;
    }

    let maxDim = 100;
    if (mesh) {
      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(mesh.positions, 3));
      geo.setIndex(new BufferAttribute(mesh.indices, 1));
      const mat = new MeshStandardMaterial({
        color: new Color(cssColor("--model", "#d2a56b")),
        flatShading: true,
        side: DoubleSide,
        roughness: 0.75,
        metalness: 0,
      });
      this.modelGroup.add(new ThreeMesh(geo, mat));
      const size = bboxSize(mesh.bbox);
      maxDim = Math.max(...size, 1e-3);
      this.bounds = new Box3(new Vector3(...mesh.bbox.min), new Vector3(...mesh.bbox.max));
      this.modelGroup.add(new Box3Helper(this.bounds, new Color(cssColor("--bbox", "#8a7f72"))));
    } else {
      this.bounds = null;
    }

    // Grid on the XY plane at z = 0, step = a power of ten near maxDim/10.
    const step = Math.pow(10, Math.floor(Math.log10(maxDim / 5)));
    const divisions = Math.min(200, Math.max(10, Math.ceil((maxDim * 3) / step / 2) * 2));
    const grid = new GridHelper(step * divisions, divisions, new Color(cssColor("--grid-major", "#9a9a9a")), new Color(cssColor("--grid-minor", "#cfcfcf")));
    grid.rotation.x = Math.PI / 2; // GridHelper is XZ by default
    this.grid = grid;
    this.scene.add(grid);

    this.camera.near = Math.max(maxDim / 1000, 0.01);
    this.camera.far = maxDim * 100;
    this.camera.updateProjectionMatrix();
    // Re-frame on a new model, or when scaling changed the size a lot (otherwise the camera
    // ends up inside the model or the model shrinks to a dot).
    const ratio = this.fitDim > 0 ? maxDim / this.fitDim : 1;
    if (fit || !mesh || ratio > 1.8 || ratio < 0.55) this.fit(maxDim);
    this.requestRender();
  }

  /** Frame the model (or a default area) from a 3/4 view. */
  fit(maxDim?: number) {
    if (!this.controls) return;
    const b = this.bounds;
    const center = b ? b.getCenter(new Vector3()) : new Vector3(0, 0, 0);
    const dim = maxDim ?? (b ? Math.max(...b.getSize(new Vector3()).toArray()) : 100);
    this.fitDim = dim;
    const dist = (dim * 1.6) / Math.tan((this.camera.fov * Math.PI) / 360);
    const dir = new Vector3(0.55, -0.75, 0.55).normalize();
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.controls.target.copy(center);
    this.controls.update();
    this.requestRender();
  }

  private resize() {
    if (!this.renderer) return;
    const w = this.container.clientWidth, hgt = this.container.clientHeight;
    if (w === 0 || hgt === 0) return;
    this.renderer.setSize(w, hgt, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  requestRender() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private render() {
    const r = this.renderer;
    if (!r) return;
    const w = this.container.clientWidth, hgt = this.container.clientHeight;
    r.setViewport(0, 0, w, hgt);
    r.setScissorTest(false);
    r.clear();
    r.render(this.scene, this.camera);

    // Axis gizmo in the bottom-left corner, same orientation as the main camera.
    const dir = this.camera.position.clone().sub(this.controls?.target ?? new Vector3()).normalize();
    this.gizmoCamera.position.copy(dir).multiplyScalar(4);
    this.gizmoCamera.lookAt(0, 0, 0);
    r.setScissorTest(true);
    r.setViewport(8, 8, GIZMO_PX, GIZMO_PX);
    r.setScissor(8, 8, GIZMO_PX, GIZMO_PX);
    r.clearDepth();
    r.render(this.gizmoScene, this.gizmoCamera);
    r.setScissorTest(false);
  }

  /** Called when the 3D tab becomes visible again (container size may have changed). */
  activate() {
    this.resize();
  }
}
