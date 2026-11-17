// Vite dev server only: serves POST /api/compare with the same handler the Vercel Function uses.
// The API key comes from the shell or .env.local and stays in Node. No password locally unless SITE_PASSWORD is set.
import {loadEnv,type Plugin} from 'vite';
import {handleCompare} from './compare-handler.js';

export function comparePlugin():Plugin{
 return {name:'model-compare-api',apply:'serve',configureServer(server){
  server.middlewares.use('/api/compare',async(req,res)=>{
   const env={...loadEnv(server.config.mode,server.config.root,['ANTHROPIC_','SITE_']),...process.env};
   const chunks:Buffer[]=[];for await(const c of req)chunks.push(c as Buffer);
   const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(typeof v==='string')headers.set(k,v);
   const request=new Request(`http://${req.headers.host}/api/compare`,{method:req.method,headers,body:req.method==='POST'?Buffer.concat(chunks):undefined});
   const response=await handleCompare(request,{apiKey:env.ANTHROPIC_API_KEY,password:env.SITE_PASSWORD||undefined,deployed:false,log:line=>server.config.logger.info(`[compare] ${line}`)});
   res.statusCode=response.status;response.headers.forEach((v,k)=>res.setHeader(k,v));
   if(!response.body)return res.end();
   const reader=response.body.getReader();
   for(;;){const {done,value}=await reader.read();if(done)break;res.write(value);}
   res.end();
  });
 }};
}
