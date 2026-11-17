import {generateWithOptions,type GenerationOptions} from './generate.js';
self.onmessage=(event:MessageEvent<GenerationOptions>)=>{try{self.postMessage({ok:true,...generateWithOptions(event.data)});}catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:'Generation failed.'});}};
