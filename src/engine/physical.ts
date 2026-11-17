export type Vec = [number,number,number];
export const DIRECTIONS:Vec[]=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
export const PHYSICAL={rodLength:63.5,rodDiameter:2,armReach:8,armRadius:2.8,socketRadius:1.15,insertionDepth:5};
export function dimensions(p=PHYSICAL){
 if(p.insertionDepth<=0||p.insertionDepth>p.armReach-p.armRadius||p.rodDiameter/2>p.socketRadius||p.socketRadius>=p.armRadius||p.rodLength<=2*p.insertionDepth) throw Error('Invalid physical dimensions.');
 return {spacing:p.rodLength+2*(p.armReach-p.insertionDepth),exposed:p.rodLength-2*p.insertionDepth};
}
export const SPACING=dimensions().spacing;
export const key=(p:Vec)=>p.join(',');
export const add=(a:Vec,b:Vec):Vec=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
export type Edge=[number,number];
export interface Design {seed:number;nodes:Vec[];edges:Edge[];fingerprint:string;score:number;experimental:boolean;descriptor:number[];groundContacts:number;}
