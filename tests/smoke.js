'use strict';
// Integration smoke test with ephemeral server + storage. No external network calls.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),assert=require('node:assert/strict');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artymods-smoke-'));fs.mkdirSync(path.join(dir,'public'),{recursive:true});fs.copyFileSync(path.join(__dirname,'../server/server.js'),path.join(dir,'server.js'));
const port=20000+Math.floor(Math.random()*16000),base='http://127.0.0.1:'+port,admin='smoke_test_admin_token_please_replace';
const server=cp.spawn(process.execPath,[path.join(dir,'server.js')],{env:{...process.env,PORT:String(port),ADMIN_TOKEN:admin},stdio:['ignore','pipe','pipe']});
function req(route,init){return fetch(base+route,init)}
(async()=>{try{
 let ready=false;for(let i=0;i<80;i++){try{const response=await req('/api/health');if(response.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}assert.ok(ready,'server started');console.log('PASS health');
 let r=await req('/api/projects');assert.equal((await r.json()).total,0);console.log('PASS empty catalog');
 r=await req('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'tester',password:'strong_password_123'})});assert.equal(r.status,201);const session=await r.json();assert.equal(session.user.username,'tester');console.log('PASS account signup');
 r=await req('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'tester',password:'strong_password_123'})});assert.equal(r.status,200);console.log('PASS account login');
 const body=Buffer.from([0x50,0x4b,3,4,0,0,0,0,0,0]);const query=new URLSearchParams({title:'Тестовый мод',description:'Независимый сервер',game_version:'1.21.11',loader:'Fabric',category:'mod',filename:'test.jar'});
 r=await req('/api/projects?'+query,{method:'POST',headers:{'Content-Type':'application/octet-stream',Authorization:'Bearer '+session.token},body});assert.equal(r.status,201,await r.text().catch(()=>''));const projectResponse=await req('/api/my-projects',{headers:{Authorization:'Bearer '+session.token}});const projects=await projectResponse.json();assert.equal(projects.projects.length,1);assert.equal(projects.projects[0].status,'pending');const id=projects.projects[0].id;console.log('PASS upload, pending moderation');
 r=await req('/api/projects');assert.equal((await r.json()).total,0);console.log('PASS unreviewed project hidden');
 r=await req('/api/admin/pending',{headers:{Authorization:'Bearer '+admin}});assert.equal((await r.json()).projects.length,1);
 r=await req('/api/admin/review',{method:'POST',headers:{Authorization:'Bearer '+admin,'Content-Type':'application/json'},body:JSON.stringify({id,status:'approved'})});assert.equal(r.status,200);console.log('PASS admin review');
 r=await req('/api/projects?loader=Fabric&query='+encodeURIComponent('Тестовый'));assert.equal((await r.json()).total,1);console.log('PASS search and filters');
 r=await req('/api/projects/'+id+'/download?filename=test.jar');assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),body);console.log('PASS file download');
 r=await req('/downloads/ArtyMods.apk');assert.equal(r.status,404);fs.mkdirSync(path.join(dir,'public','downloads'),{recursive:true});fs.writeFileSync(path.join(dir,'public','downloads','ArtyMods.apk'),Buffer.from('test-apk-placeholder'));r=await req('/downloads/ArtyMods.apk');assert.equal(r.status,200);console.log('PASS APK download route after publishing file');
 console.log('ALL SERVER TESTS PASSED');
 }catch(err){console.error(err);process.exitCode=1;}finally{server.kill();fs.rmSync(dir,{recursive:true,force:true});}})();
