import {useMemo} from 'react';import * as THREE from 'three';import {DIRECTIONS,PHYSICAL} from '../engine/physical';
// Revolved tube wall with a rounded lip; its bore terminates at the insertion stop.
export function Connector({color='#e8e7e2'}:{color?:string}){
 const geometry=useMemo(()=>{const {armRadius:r,armReach:l,socketRadius:b,insertionDepth:d}=PHYSICAL;return new THREE.LatheGeometry([new THREE.Vector2(r,0),new THREE.Vector2(r,l-.45),new THREE.Vector2(r-.15,l),new THREE.Vector2(b+.15,l),new THREE.Vector2(b,l-.25),new THREE.Vector2(b,l-d),new THREE.Vector2(0,l-d)],16);},[]);
 return <group><mesh><sphereGeometry args={[2.95,16,12]}/><meshStandardMaterial color={color} roughness={.36}/></mesh>{DIRECTIONS.map((d,i)=><mesh key={i} geometry={geometry} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(...d))}><meshStandardMaterial color={color} roughness={.32}/></mesh>)}</group>;
}
