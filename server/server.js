'use strict';
/** Independent ArtyMods server. Node.js 20+, no npm dependencies. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {URL} = require('node:url');
const {pipeline} = require('node:stream/promises');
const ROOT = __dirname, PUBLIC = path.join(ROOT, 'public'), UPLOADS = path.join(ROOT,'uploads'), DATA = path.join(ROOT,'data'), DB = path.join(DATA,'database.json');
const PORT = Number(process.env.PORT || 3000), MAX_FILE = 50 * 1024 * 1024, MAX_JSON = 16*1024;
const ALLOWED_ORIGINS = new Set((process.env.APP_ORIGINS || 'https://app.artymods.local').split(',').map(x=>x.trim()).filter(Boolean));
for (const dir of [PUBLIC, UPLOADS, DATA, path.join(PUBLIC,'downloads')]) fs.mkdirSync(dir,{recursive:true});
let db = {users:[],tokens:[],projects:[]};
if (fs.existsSync(DB)) db = JSON.parse(fs.readFileSync(DB,'utf8'));
function save() { const tmp=DB+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(db,null,2),{mode:0o600}); fs.renameSync(tmp,DB); }
const sha = x=>crypto.createHash('sha256').update(x).digest('hex');
function send(res,status,body,headers={}) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(body)); }
function fail(res,status,message){send(res,status,{error:message});}
function cookieFreeCors(req,res){ const origin=req.headers.origin;if(origin && (ALLOWED_ORIGINS.has(origin)||origin===`http://${req.headers.host}`||origin===`https://${req.headers.host}`)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');} }
const hits=new Map();function throttled(req,kind,max,windowMs){ const address=req.socket.remoteAddress||'unknown', key=kind+':'+address,now=Date.now();let h=hits.get(key)||[];h=h.filter(t=>now-t<windowMs);h.push(now);hits.set(key,h);if(hits.size>15000){for(const [k,v] of hits)if(!v.length||now-v[v.length-1]>windowMs)hits.delete(k);}return h.length>max; }
function readJSON(req){return new Promise((resolve,reject)=>{let size=0,parts=[];req.on('data',c=>{size+=c.length;if(size>MAX_JSON){reject(new Error('Слишком большой запрос'));req.destroy();return}parts.push(c)});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')))}catch(e){reject(new Error('Неверный JSON'))}});req.on('error',reject);});}
function currentUser(req){const header=req.headers.authorization||'';if(!header.startsWith('Bearer '))return null;const token=header.slice(7);if(!/^[0-9a-f]{64}$/.test(token))return null;const match=db.tokens.find(t=>t.hash===sha(token)&&t.expires>Date.now());return match?db.users.find(u=>u.id===match.userId):null;}
function session(user){const token=crypto.randomBytes(32).toString('hex');db.tokens=db.tokens.filter(t=>t.expires>Date.now());db.tokens.push({hash:sha(token),userId:user.id,expires:Date.now()+30*86400000});save();return{token,user:{id:user.id,username:user.username}};}
function publicProject(p){return{id:p.id,title:p.title,description:p.description,loader:p.loader,game_version:p.game_version,category:p.category,created_at:p.created_at,downloads:p.downloads||0,username:p.username,filename:p.filename,sha256:p.sha256,size:p.size,download_url:`/api/projects/${p.id}/download`};}
function staticFile(res,file,mime){try{const stat=fs.statSync(file);if(!stat.isFile())return fail(res,404,'Файл не найден');res.writeHead(200,{'Content-Type':mime,'Content-Length':stat.size,'X-Content-Type-Options':'nosniff','Cache-Control':mime.includes('html')?'no-cache':'public, max-age=300'});fs.createReadStream(file).pipe(res);}catch{return fail(res,404,'Файл не найден');}}
function upload(req,res,search,user){return new Promise(async(resolve)=>{
 let title=(search.get('title')||'').trim(),description=(search.get('description')||'').trim(),game_version=(search.get('game_version')||'').trim(),loader=search.get('loader')||'',category=search.get('category')||'mod',filename=(search.get('filename')||'').trim();
 if(!title||title.length>80||description.length>600||!game_version||game_version.length>40||!['Fabric','Forge','NeoForge','Quilt','Universal'].includes(loader)||!['mod','shader','resourcepack','modpack'].includes(category)||!/^[^/\\\x00-\x1f]{1,100}\.(jar|zip)$/i.test(filename)){fail(res,400,'Проверь название, файл, категорию, загрузчик и версию');return resolve();}
 if(req.headers['content-type']!=='application/octet-stream'){fail(res,415,'Отправь двоичный файл application/octet-stream');return resolve();}
 if(req.headers['content-length']&&Number(req.headers['content-length'])>MAX_FILE){fail(res,413,'Максимум 50 МБ');return resolve();}
 const id=crypto.randomUUID(),stored=id+path.extname(filename).toLowerCase(),target=path.join(UPLOADS,stored);
 let bytes=0,first=Buffer.alloc(0),hash=crypto.createHash('sha256'),output=fs.createWriteStream(target,{flags:'wx',mode:0o600}),failed=false;
 try{
  for await(const chunk of req){bytes+=chunk.length;if(bytes>MAX_FILE)throw Error('Максимум 50 МБ');if(first.length<4)first=Buffer.concat([first,chunk.subarray(0,4-first.length)]);hash.update(chunk);if(!output.write(chunk))await new Promise(ok=>output.once('drain',ok));}
  await new Promise((ok,bad)=>output.end(e=>e?bad(e):ok()));
  // ZIP/JAR container magic. Upload remains untrusted until admin review.
  if(bytes<4||first[0]!==0x50||first[1]!==0x4b||!((first[2]===3&&first[3]===4)||(first[2]===5&&first[3]===6)||(first[2]===7&&first[3]===8)))throw Error('Файл не похож на ZIP/JAR');
  const p={id,title,description,game_version,loader,category,filename,stored,sha256:hash.digest('hex'),size:bytes,username:user.username,owner_id:user.id,downloads:0,created_at:new Date().toISOString(),status:process.env.AUTO_APPROVE==='true'?'approved':'pending'};
  db.projects.unshift(p);save();send(res,201,{project:publicProject(p),status:p.status,message:p.status==='approved'?'Мод опубликован':'Файл отправлен на модерацию'});
 }catch(err){failed=true;fail(res,400,err.message||'Ошибка загрузки');}finally{if(failed){output.destroy();try{fs.unlinkSync(target)}catch{}}resolve();}
 });}
const server=http.createServer(async(req,res)=>{
 cookieFreeCors(req,res);if(req.method==='OPTIONS'){res.writeHead(204);return res.end()}
 let u;try{u=new URL(req.url,'http://localhost')}catch{return fail(res,400,'Неверный URL')}
 const {pathname,searchParams}=u;
 try{
  if(pathname==='/api/health'&&req.method==='GET')return send(res,200,{ok:true,platform:'ArtyMods',service:'independent'});
  if(pathname==='/api/auth/register'&&req.method==='POST'){
   if(throttled(req,'auth',12,15*60*1000))return fail(res,429,'Слишком много попыток');
   const b=await readJSON(req),username=String(b.username||'').trim(),password=String(b.password||'');
   if(!/^[\p{L}\p{N}_-]{3,24}$/u.test(username)||password.length<10||password.length>128)return fail(res,400,'Ник 3–24 символа; пароль минимум 10 символов');
   if(db.users.some(x=>x.username.toLowerCase()===username.toLowerCase()))return fail(res,409,'Ник уже занят');
   const salt=crypto.randomBytes(16).toString('hex'),passwordHash=crypto.scryptSync(password,salt,64).toString('hex'),user={id:crypto.randomUUID(),username,salt,passwordHash,created_at:new Date().toISOString()};db.users.push(user);save();return send(res,201,session(user));
  }
  if(pathname==='/api/auth/login'&&req.method==='POST'){
   if(throttled(req,'auth',12,15*60*1000))return fail(res,429,'Слишком много попыток');
   const b=await readJSON(req),username=String(b.username||''),password=String(b.password||'');const user=db.users.find(x=>x.username.toLowerCase()===username.toLowerCase());
   if(!user||password.length>128||!crypto.timingSafeEqual(crypto.scryptSync(password,user.salt,64),Buffer.from(user.passwordHash,'hex')))return fail(res,401,'Неверный ник или пароль');
   return send(res,200,session(user));
  }
  if(pathname==='/api/me'&&req.method==='GET'){let user=currentUser(req);return user?send(res,200,{id:user.id,username:user.username}):fail(res,401,'Войди в аккаунт');}
  if(pathname==='/api/projects'&&req.method==='GET'){
   let q=(searchParams.get('query')||'').toLowerCase().slice(0,100),loader=searchParams.get('loader')||'all',category=searchParams.get('category')||'all';let arr=db.projects.filter(p=>p.status==='approved'&&(loader==='all'||p.loader===loader)&&(category==='all'||p.category===category)&&(!q||(p.title+' '+p.description).toLowerCase().includes(q)));return send(res,200,{projects:arr.slice(0,100).map(publicProject),total:arr.length});
  }
  if(pathname==='/api/my-projects'&&req.method==='GET'){const user=currentUser(req);if(!user)return fail(res,401,'Войди в аккаунт');return send(res,200,{projects:db.projects.filter(p=>p.owner_id===user.id).map(p=>({...publicProject(p),status:p.status}))});}
  if(pathname==='/api/projects'&&req.method==='POST'){
   let user=currentUser(req);if(!user)return fail(res,401,'Войди в аккаунт');if(throttled(req,'upload',10,60*60*1000))return fail(res,429,'Лимит публикаций за час');return await upload(req,res,searchParams,user);
  }
  const match=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})(?:\/(download))?$/);
  if(match&&req.method==='GET'){
   let p=db.projects.find(x=>x.id===match[1]);if(!p||p.status!=='approved')return fail(res,404,'Проект пока недоступен');
   if(match[2]==='download'){
    let file=path.join(UPLOADS,p.stored);if(!fs.existsSync(file))return fail(res,404,'Файл не найден');p.downloads=(p.downloads||0)+1;save();let clean=p.filename.replace(/["\\\r\n]/g,'_');res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${clean.replace(/[^\x20-\x7e]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(clean)}`,'X-Content-Type-Options':'nosniff','Content-Length':p.size,'Cache-Control':'no-store'});return fs.createReadStream(file).pipe(res);
   }
   return send(res,200,{project:publicProject(p)});
  }
  if(pathname==='/api/admin/review'&&req.method==='POST'){
   const auth=(req.headers.authorization||'').replace(/^Bearer /,'');if(!process.env.ADMIN_TOKEN||!auth||auth.length!==process.env.ADMIN_TOKEN.length||!crypto.timingSafeEqual(Buffer.from(auth),Buffer.from(process.env.ADMIN_TOKEN)))return fail(res,403,'Запрещено');
   const b=await readJSON(req),p=db.projects.find(x=>x.id===b.id);if(!p)return fail(res,404,'Проект не найден');if(!['approved','rejected'].includes(b.status))return fail(res,400,'Статус должен быть approved или rejected');p.status=b.status;save();return send(res,200,{ok:true,status:p.status});
  }
  if(pathname==='/api/admin/pending'&&req.method==='GET'){
   const auth=(req.headers.authorization||'').replace(/^Bearer /,'');if(!process.env.ADMIN_TOKEN||!auth||auth.length!==process.env.ADMIN_TOKEN.length||!crypto.timingSafeEqual(Buffer.from(auth),Buffer.from(process.env.ADMIN_TOKEN)))return fail(res,403,'Запрещено');return send(res,200,{projects:db.projects.filter(p=>p.status==='pending').map(publicProject)});
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return fail(res,404,'Маршрут не найден');
  if(pathname==='/downloads/ArtyMods.apk'){
   const apk=path.join(PUBLIC,'downloads','ArtyMods.apk');if(!fs.existsSync(apk))return fail(res,404,'APK ещё не опубликован. Администратор должен собрать приложение и загрузить ArtyMods.apk на сервер.');return staticFile(res,apk,'application/vnd.android.package-archive');
  }
  const assetMap={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js','/favicon.svg':'favicon.svg'};
  if(assetMap[pathname])return staticFile(res,path.join(PUBLIC,assetMap[pathname]),pathname.endsWith('.css')?'text/css; charset=utf-8':pathname.endsWith('.js')?'application/javascript; charset=utf-8':pathname.endsWith('.svg')?'image/svg+xml': 'text/html; charset=utf-8');
  return fail(res,404,'Страница не найдена');
 }catch(e){console.error(e);if(!res.headersSent)fail(res,500,'Внутренняя ошибка сервера');else res.destroy();}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`ArtyMods listening on http://localhost:${PORT}`));
