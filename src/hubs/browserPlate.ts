// Browser-only: loads the manifold WebAssembly through Vite and builds the print plate STL.
import type {StickDesign} from './design';

export async function plateSTL(d: StickDesign): Promise<Uint8Array> {
  const [{default: Module}, {default: wasmUrl}, {buildHub, printPlate, toSTL}] = await Promise.all([
    import('manifold-3d'), import('manifold-3d/manifold.wasm?url'), import('./hubmesh'),
  ]);
  const wasm = await Module({locateFile: () => wasmUrl});
  wasm.setup();
  const hubs = d.holes.map(h => buildHub(wasm, h, d.params));
  const plate = printPlate(wasm, hubs);
  const stl = toSTL(plate.getMesh());
  [...hubs, plate].forEach(m => m.delete());
  return stl;
}
