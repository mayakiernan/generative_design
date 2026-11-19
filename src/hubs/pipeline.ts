import {design, type StickDesign} from './design';
import {partsGraph} from './parts';
import {DEFAULT_HUB, type HubParams} from './params';
import {shellGraph} from './shell';
import type {ShapeSource} from './shapes';

/** Shape source -> stick graph -> hole depths. Mesh sources take the shell path, part lists the frame path. */
export function makeDesign(source: ShapeSource, p: HubParams = DEFAULT_HUB, sticks?: number): StickDesign {
  const graph = source.kind === 'mesh'
    ? shellGraph(source.mesh, sticks ?? source.sticks, p).graph
    : partsGraph(source.parts, p);
  return design(source.name, graph, p);
}
