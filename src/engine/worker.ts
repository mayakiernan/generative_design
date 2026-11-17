import {generate} from './generate';
self.onmessage=(event:MessageEvent<{n:number;e:number;seed:number}>)=>{try{const {n,e,seed}=event.data;self.postMessage({ok:true,...generate(n,e,seed)});}catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:'Generation failed.'});}};
