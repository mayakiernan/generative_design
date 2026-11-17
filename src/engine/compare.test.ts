import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,largestClearSpan,toGraph,toDesign,feedback,systemPrompt,type ModelDesign} from './compare';
import type {Vec} from './physical';

// A flat two-wide deck on four legs, with the legs `gap` lattice units apart along x.
function bridge(gap:number):ModelDesign{
 const pts:Vec[]=[],rods:[Vec,Vec][]=[];
 for(const x of [0,gap])for(const z of [0,1]){pts.push([x,0,z]);rods.push([[x,0,z],[x,1,z]]);}
 for(const x of [0,gap])rods.push([[x,0,0],[x,0,1]]);
 for(let x=0;x<=gap;x++)for(const z of [0,1]){pts.push([x,1,z]);if(x<gap)rods.push([[x,1,z],[x+1,1,z]]);}
 for(let x=0;x<=gap;x++)rods.push([[x,1,0],[x,1,1]]);
 const id=(p:Vec)=>pts.findIndex(q=>q.join()===p.join());
 return {name:'test bridge',rationale:'',connectors:pts.map(([x,y,z],i)=>({id:i,x,y,z})),rods:rods.map(([a,b])=>({from:id(a),to:id(b)}))};
}
const brief={maxConnectors:25,gapMm:152.4,freestanding:true};

test('clear span is lattice distance x 69.5 minus two 2.8 mm contacts',()=>{
 const wide=largestClearSpan(toGraph(bridge(3)).nodes)!;
 assert.equal(wide.axis,'x');assert.deepEqual(wide.between,[0,3]);assert.ok(Math.abs(wide.clearMm-202.9)<1e-9);
 assert.ok(Math.abs(largestClearSpan(toGraph(bridge(2)).nodes)!.clearMm-133.4)<1e-9);
 assert.equal(largestClearSpan([[0,0,0],[0,1,0]]),null);
});

test('a 3-unit bridge passes the 6 inch brief; a 2-unit one falls short',()=>{
 const pass=evaluate(bridge(3),brief);
 assert.equal(pass.passes,true,JSON.stringify(pass.checks));
 assert.equal(pass.connectors,12);assert.equal(pass.rods,16);assert.equal(pass.stable,true);
 const short=evaluate(bridge(2),brief);
 assert.equal(short.valid,true);assert.equal(short.passes,false);
 assert.equal(short.checks.find(c=>c.label==='Spans gap')!.pass,false);
 assert.match(feedback(short),/Spans gap: 133\.4 mm clear, 152\.4 mm needed/);
});

test('budgets are hard limits and only listed constraints are checked',()=>{
 const over=evaluate(bridge(3),{...brief,maxConnectors:10});
 assert.equal(over.passes,false);assert.equal(over.checks.find(c=>c.label==='Connectors')!.detail,'12 of 10 max');
 assert.deepEqual(evaluate(bridge(3),{}).checks.map(c=>c.label),['Valid geometry']);
});

test('off-lattice rods, unknown ids and duplicate ids are reported',()=>{
 const d=bridge(3);
 d.rods.push({from:0,to:999},{from:0,to:d.connectors.findIndex(c=>c.x===2&&c.y===1&&c.z===0)});
 d.connectors.push({id:0,x:9,y:9,z:9});
 const e=evaluate(d,brief);
 assert.equal(e.valid,false);assert.equal(e.passes,false);
 assert.match(e.checks[0].detail,/names a connector that is not listed/);
 assert.match(e.checks[0].detail,/listed more than once/);
 assert.match(e.checks[0].detail,/Invalid rod length/);
 assert.equal(evaluate({name:'',rationale:'',connectors:[],rods:[]},brief).valid,false);
});

test('model designs become full engine designs for the viewer',()=>{
 const d=toDesign(bridge(3),7)!;
 assert.equal(d.seed,7);assert.equal(d.nodes.length,12);assert.equal(d.edges.length,16);assert.ok(d.fingerprint.length>0);assert.equal(d.experimental,false);
 assert.match(systemPrompt(),/69\.5 mm/);assert.match(systemPrompt(),/2\.8 mm/);
});
