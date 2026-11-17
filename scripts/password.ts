// Dependency-free so Routing Middleware can import it without pulling in the API client.
function sameText(a:string,b:string){let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;}
/** HTTP Basic auth against SITE_PASSWORD (any username). With no password set, only local dev is open. */
export function passwordOk(request:Request,password:string|undefined,deployed:boolean):boolean{
 if(!password)return !deployed;
 const [scheme,encoded]=(request.headers.get('authorization')??'').split(' ');
 if(scheme!=='Basic'||!encoded)return false;
 let decoded='';try{decoded=atob(encoded);}catch{return false;}
 return sameText(decoded.slice(decoded.indexOf(':')+1),password);
}

