'use strict';
// Independent, bounded re-review of RD-01..09. No source edits and no real database.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm'),crypto=require('node:crypto'),ts=require('typescript');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const prefix='comprehensive-design-readiness-round2';
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const protectedFiles=['docs','scripts'].flatMap(d=>files(path.join(root,d))).filter(p=>!path.basename(p).startsWith(prefix)&&path.basename(p)!=='COMPREHENSIVE_DESIGN_READINESS_REVIEW_ROUND2.md');
const before=Object.fromEntries(protectedFiles.map(p=>[p,sha(p)]));
const sourcePaths=['ARCHITECTURE_SPEC','BACKEND_ARCHITECTURE_SPEC','FRONTEND_ARCHITECTURE_SPEC','API_CONTRACT_SPEC','DATABASE_DESIGN_SPEC'].map(n=>'docs/'+n+'.md').concat(['docs/sql/001_metadata_schema.sql','docs/contracts/readiness.types.ts','docs/contracts/readiness.fixtures.json','docs/contracts/endpoint-trace.json']);
const [arch,be,fe,api,db,ddl,types]=sourcePaths.map(read);
const observations=[];
function section(text,heading){const start=text.indexOf(heading);assert(start>=0,heading);const level=heading.match(/^#+/)[0].length,tail=text.slice(start+heading.length),m=new RegExp('\n#{1,'+level+'} ').exec(tail);return text.slice(start,m?start+heading.length+m.index:text.length);}
function block(text,heading,needle){const m=[...section(text,heading).matchAll(/```(?:ts|typescript)\n([\s\S]*?)```/g)].find(m=>m[1].includes(needle));assert(m,needle);return m[1];}
function load(code,globals={}){const exports={};vm.runInNewContext(ts.transpileModule(code.replace(/^import .*;\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,Buffer,crypto,...globals},{timeout:3000});return exports;}
function compile(code){const file=path.join(root,'__bounded_review_virtual__.ts');const opts={strict:true,noEmit:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,moduleResolution:ts.ModuleResolutionKind.Node10,esModuleInterop:true,types:['node'],typeRoots:[path.dirname(path.dirname(require.resolve('@types/node/package.json')))]};const host=ts.createCompilerHost(opts),old=host.getSourceFile.bind(host);host.getSourceFile=(f,v,...rest)=>path.resolve(f)===file?ts.createSourceFile(f,code,v,true):old(f,v,...rest);return ts.getPreEmitDiagnostics(ts.createProgram([file],opts,host)).map(d=>({code:d.code,line:d.file&&d.start!==undefined?d.file.getLineAndCharacterOfPosition(d.start).line+1:null,message:ts.flattenDiagnosticMessageText(d.messageText,'\n')}));}
async function check(id,name,fn){const detail=await fn();observations.push({id,name,holds:true,...detail});}
class AppError extends Error{constructor(p){super(p.message);Object.assign(this,p);}}
async function main(){
await check('RD-01','All allocation branches share a locked counter and use real physical columns',()=>{
 const text=section(api,'#### 6.7.4 '),sql=text.match(/```sql\n([\s\S]*?)```/)[1];
 const counter=sql.indexOf('UPDATE sys_rate_limit_revisions'),create=sql.indexOf('INSERT INTO sys_rate_limits ('),update=sql.indexOf('UPDATE sys_rate_limits SET');
 assert(counter>0&&counter<create&&counter<update);assert(sql.includes('SET last_revision = last_revision + 1'));
 assert(sql.includes('revision = ?, version = ?'));assert(sql.includes('4294967295'));assert(!sql.includes('user_quota_qpm'));
 const rule=ddl.match(/CREATE TABLE `sys_rate_limits` \(([\s\S]*?)\) ENGINE=/)[1];for(const c of ['qpm_limit','burst_capacity','revision','version'])assert(rule.includes('`'+c+'`'));
 assert(section(be,'#### 4.4.3 ').includes('revision=version=last_revision'));assert(section(db,'### 7.5 ').includes('newRevision = last_revision + 1'));
 return {counterBeforeBothBranches:true,physicalColumn:'qpm_limit',boundary:'Structural protocol verification; executed sequence models are in the rerun evidence'};
});
const poolCode=block(be,'### 4.2 ','createMetadataPool');
const poolModule=load(poolCode);
await check('RD-02-core','Metadata executor initializes each borrow, awaits SET, and releases after SQL failure',async()=>{
 const trace=[];let releaseInit;const initGate=new Promise(r=>{releaseInit=r;});let first=true;
 const conn={query:async(sql)=>{trace.push(sql);if(sql.startsWith('SET SESSION')&&first){first=false;await initGate;}if(sql==='FAIL')throw Error('business-failure');return [[{ok:true}],[]];},release:()=>trace.push('release'),destroy:()=>trace.push('destroy')};
 const pool={getConnection:async()=>{trace.push('acquire');return conn;}};
 const q=poolModule.createMetadataQueryExecutor(pool);const pending=q.query('SELECT 1');await new Promise(r=>setImmediate(r));assert.deepEqual(trace,['acquire',"SET SESSION time_zone = '+00:00'"]);releaseInit();await pending;
 await assert.rejects(q.query('FAIL'),/business-failure/);assert.equal(trace.filter(t=>t.startsWith('SET SESSION')).length,2);assert.equal(trace.filter(t=>t==='release').length,2);assert(!trace.includes('destroy'));
 const failTrace=[];const bad={getConnection:async()=>({query:async()=>{failTrace.push('SET');throw Error('timezone-failure');},destroy:()=>failTrace.push('destroy'),release:()=>failTrace.push('release')})};
 await assert.rejects(poolModule.createMetadataQueryExecutor(bad).query('SELECT 1'),/timezone-failure/);assert.deepEqual(failTrace,['SET','destroy']);
 return {trace,failedInitialization:failTrace,boundary:'Complete extracted executor and controlled pool/connection'};
});
await check('RD-02-transaction','Real transaction wrapper uses the UTC acquisition function before BEGIN',async()=>{
 const source=block(be,'### 4.3 ','withTransaction');const {withTransaction}=load(source,{AppError,acquireMetadataConnection:poolModule.acquireMetadataConnection});
 const trace=[];const conn={query:async s=>trace.push(s),beginTransaction:async()=>trace.push('begin'),commit:async()=>trace.push('commit'),rollback:async()=>trace.push('rollback'),release:()=>trace.push('release'),destroy:()=>trace.push('destroy')};
 const pool={getConnection:async()=>conn};await withTransaction(pool,async()=>trace.push('business'));
 assert.deepEqual(trace,["SET SESSION time_zone = '+00:00'",'begin','business','commit','release']);trace.length=0;
 await assert.rejects(withTransaction(pool,async()=>{throw Error('rejected');}),/rejected/);assert.deepEqual(trace,["SET SESSION time_zone = '+00:00'",'begin','rollback','release']);
 return {rollbackTrace:trace,boundary:'Extracted transaction wrapper; no MySQL server'};
});
await check('RR2-01','Audit query consumer must compile and accept the new safe executor',()=>{
 const source=block(be,'### 10.3 ','queryAuditLogs');
 const driver=JSON.stringify(require.resolve('mysql2/promise').replaceAll('\\','/'));
 // Resolve only the internal imported type to its actual definition; do not restore the missing mysql2 binding.
 const iface=poolCode.match(/export interface MetadataQueryExecutor \{[\s\S]*?\n\}/)[0].replace('export interface','interface').replaceAll('mysql2.','MysqlTypes.');
 const importShim=`import type MysqlTypes from ${driver};\n${iface}`;
 const isolated=source.replace("import type { MetadataQueryExecutor } from './metadata-pool';",importShim);
 const currentDiagnostics=compile(isolated);assert.equal(currentDiagnostics.filter(d=>d.code===2503).length,2);
 const caller='\ndeclare const safeQueries: MetadataQueryExecutor; queryAuditLogs(safeQueries,{page:1,pageSize:20});';
 const importOnly=compile(`import type mysql2 from ${driver};\n`+isolated+caller);assert(importOnly.some(d=>d.code===2345));
 const fixed=compile(isolated.replace('pool: mysql2.Pool','pool: MetadataQueryExecutor').replaceAll('mysql2.RowDataPacket','MysqlTypes.RowDataPacket')+caller);assert.deepEqual(fixed,[]);
 return {holds:false,priority:'P2',parentIssue:'RD-02',sourceLine:be.slice(0,be.indexOf(source)).split('\n').length,currentDiagnostics,importOnlyDiagnostics:importOnly,correctedInMemoryControlDiagnostics:fixed,boundary:'Actual TypeScript 5.9.3 with actual mysql2 types, internal import isolated; control is in memory only'};
});
await check('RD-03','Only one physical DDL, exactly 14 tables and one internal bootstrap marker seed',()=>{
 assert(!/CREATE TABLE `sys_/.test(arch));assert(!/CREATE TABLE `sys_/.test(be));
 assert(arch.includes('docs/sql/001_metadata_schema.sql'));assert(be.includes('docs/sql/001_metadata_schema.sql'));
 const tables=[...ddl.matchAll(/CREATE TABLE `([^`]+)`/g)].map(m=>m[1]);assert.equal(tables.length,14);assert.equal(new Set(tables).size,14);
 assert(ddl.includes("VALUES ('bootstrap_state', 'PENDING', 0,"));assert(ddl.indexOf("VALUES ('bootstrap_state'")>ddl.lastIndexOf('CREATE TABLE'));
 assert(ddl.includes('REFERENCES `sys_roles` (`id`) ON DELETE RESTRICT'));assert(/`profile_name` VARCHAR\(128\)/.test(ddl));assert(ddl.includes('utf8mb4_0900_as_cs'));assert(ddl.includes('`pending_user_id`'));
 return {tables,markerIsOnlyInitializationSeed:[...ddl.matchAll(/^INSERT INTO /gm)].length===1,boundary:'SQL structure checks, not engine parsing'};
});
await check('RD-04','Canonical response and real edit mapper agree on username vs user',()=>{
 const fixture=JSON.parse(section(api,'#### 6.5.1 ').match(/```json\n([\s\S]*?)```/)[1])[0];
 const source=block(fe,'### 8.2 ','profileToEditForm');const {profileToEditForm}=load(source);const mapped=profileToEditForm(fixture);
 assert.equal(mapped.user,fixture.username);for(const key of ['username','password','ssh_private_key','id','status','created_at','updated_at'])assert(!Object.hasOwn(mapped,key),key);
 const dto=fe.match(/export interface ProfileReadDTO \{[\s\S]*?\n\}/)[0];
 const diagnostics=compile(dto+'\nconst p: ProfileReadDTO = '+JSON.stringify(fixture)+';');assert.deepEqual(diagnostics,[]);
 const negative=compile(dto.replace('  username: string;','  user: string;')+'\nconst p: ProfileReadDTO = '+JSON.stringify(fixture)+';');assert(negative.some(d=>(d.code===2353 && /\busername\b/.test(d.message)) || (d.code===2741 && d.message.includes("'user'"))), JSON.stringify(negative));
 return {mappedKeys:Object.keys(mapped),diagnostics,oldBugControlDiagnostics:negative,oldBugControlRejected:true};
});
await check('RD-05','Generated shapes reject the formerly missing field and wrong export key',()=>{
 assert.deepEqual(compile(types+'\nconst p: GlobalRateLimitPayload = {defaultUserQuotaQpm:60,burstCapacity:10,agentLoopThreshold:3,agentLoopWindowSec:30,version:1};'),[]);
 const missing=compile(types+'\nconst p: GlobalRateLimitPayload = {defaultUserQuotaQpm:60,agentLoopThreshold:3,agentLoopWindowSec:30,version:1};');assert(missing.some(d=>d.message.includes('burstCapacity')));
 const wrong=compile(types+'\nconst p: ExportAuditPayload = {range:"today",profileId:"100"};');assert(wrong.some(d=>d.message.includes('profileId')));
 assert.deepEqual(compile(types+'\nconst p: ExportAuditPayload = {range:"today",profile_id:"100"}; const s: TestSshPayload={hostFingerprintSha256:"SHA256:test"};'),[]);
 return {missingBurstRejected:true,wrongExportKeyRejected:true,scope:'Shape only, not runtime/conditional Schema validation'};
});
await check('RD-06','All 47 exact method/path pairs are present without duplicated matrix entries',()=>{
 const canonical=[...api.matchAll(/\*\*接口路径\*\*：`([A-Z]+ \/api\/v1\/[^`]+)`/g)].map(m=>m[1]).sort();assert.equal(canonical.length,47);
 function routes(text){return [...text.matchAll(/`(\/api\/v1\/[^`]+)`\s*\|\s*`([A-Z/]+)`/g)].flatMap(m=>m[2].split('/').map(v=>v+' '+m[1])).sort();}
 const frontend=routes(section(fe,'### 8.1 ')),backend=routes(section(be,'### 11.1 '));assert.deepEqual(frontend,canonical);assert.deepEqual(backend,canonical);
 const trace=JSON.parse(read('docs/contracts/endpoint-trace.json'));assert.deepEqual(trace.map(r=>r.method+' '+r.path).sort(),canonical);
 return {canonical:47,frontend:frontend.length,backend:backend.length,trace:trace.length};
});
await check('RD-07','Stable role lock and self/last-admin decisions use the same guard',async()=>{
 const {UserService}=load(block(be,'### 4.4 ','class UserService'),{AppError,toEntityId:x=>String(x)});const service=new UserService({}, {}, {});
 const a='9007199254740993',b='9007199254740995';const cases=[
  {name:'last-active',users:[{id:a,status:'ACTIVE'}],bindings:[{user_id:a}],target:a,operator:b,lose:x=>x,error:'ERR_LAST_SUPER_ADMIN'},
  {name:'two-active',users:[{id:a,status:'ACTIVE'},{id:b,status:'ACTIVE'}],bindings:[{user_id:a},{user_id:b}],target:a,operator:b,lose:x=>x,error:null},
  {name:'unrelated-self-change',users:[{id:a,status:'ACTIVE'}],bindings:[{user_id:a}],target:a,operator:a,lose:()=>false,error:null},
  {name:'self-removal',users:[{id:a,status:'ACTIVE'},{id:b,status:'ACTIVE'}],bindings:[{user_id:a},{user_id:b}],target:a,operator:a,lose:x=>x,error:'ERR_SELF_ACTION_PROHIBITED'},
  {name:'inactive-target',users:[{id:a,status:'DISABLED'},{id:b,status:'ACTIVE'}],bindings:[{user_id:a},{user_id:b}],target:a,operator:b,lose:x=>x,error:null}];
 for(const c of cases){const calls=[];const conn={query:async sql=>{calls.push(sql);if(sql.includes('FROM sys_roles'))return [[{id:'17'}]];if(sql.includes('FROM sys_users'))return [c.users];if(sql.includes('FROM sys_user_roles'))return [c.bindings];throw Error(sql);}};let error=null;try{await service.guardLastSuperAdminInTx(conn,c.target,c.operator,c.lose);}catch(e){error=e.code;}assert.equal(error,c.error,c.name);assert(calls[0].includes('FROM sys_roles'));assert(calls[1].includes('FROM sys_users'));assert(calls[2].includes('FROM sys_user_roles'));assert(calls.every(s=>s.includes('FOR UPDATE')));}
 assert(section(api,'### 5.4 ').includes("SELECT id FROM sys_roles WHERE role_name = 'SUPER_ADMIN' FOR UPDATE"));
 return {cases:cases.map(({name,error})=>({name,error})),boundary:'Actual extracted guard; controlled rows, no InnoDB scheduler'};
});
await check('RD-09','Every one of the 14 dirty PENDING tables prevents account creation',async()=>{
 const source=block(be,'### 5.1 ','class BootstrapService');const all=[...ddl.matchAll(/CREATE TABLE `([^`]+)`/g)].map(m=>m[1]);const tested=[];
 for(const dirty of all){const calls=[];let hashes=0,deliveries=0;const conn={query:async(sql,args=[])=>{calls.push(sql);if(sql.includes("WHERE setting_key = 'bootstrap_state' FOR UPDATE"))return [[{setting_value:'PENDING'}]];if(sql.startsWith('SELECT 1 FROM ??'))return [args[0]===dirty?[{one:1}]:[]];throw Error('Unexpected mutation or query: '+sql);}};
 const {BootstrapService}=load(source,{withTransaction:async(_,f)=>f(conn),hashPassword:async()=>{hashes++;return 'hash';}});
 const svc=new BootstrapService({}, {}, {encrypt:x=>x,decrypt:x=>x},async()=>{deliveries++;});
 await assert.rejects(svc.ensureSystemInitialized(),/PENDING database is not empty/);assert.equal(hashes,0);assert.equal(deliveries,0);assert(!calls.some(s=>/^\s*(INSERT|UPDATE)\b/.test(s)));tested.push(dirty);}
 return {tested,mutations:0,boundary:'Actual BootstrapService, each table independently nonempty; transaction responses controlled'};
});
await check('RD-08','Unapproved decisions are explicitly retained instead of claimed closed',()=>{
 for(const text of ['未签署前不冻结联调基线','新库暂取10，旧15不自动覆盖','冲突待澄清','建议向上取整'])assert(db.includes(text),text);
 return {productAndInterfaceSignoff:'pending/not evidenced in repository',notATechnicalRegression:true};
});
await check('source-sync','Four compiled documents equal their declared parts; generated contracts match source',()=>{
 const checks=[];
 for(const [dir,name]of [['arch_parts','ARCHITECTURE_SPEC'],['be_parts','BACKEND_ARCHITECTURE_SPEC'],['fe_parts','FRONTEND_ARCHITECTURE_SPEC'],['contract_parts','API_CONTRACT_SPEC']]){
  const parts=fs.readdirSync(path.join(root,'scripts',dir)).filter(n=>/^part\d+_.*\.md$/.test(n)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));assert.equal(parts.map(p=>read('scripts/'+dir+'/'+p).trim()).join('\n\n---\n\n'),read('docs/'+name+'.md'));checks.push({name,parts:parts.length});}
 const generated=spawnSync('python',['scripts/generate_readiness_contracts.py','--check'],{cwd:root,encoding:'utf8'});assert.equal(generated.status,0,generated.stdout+generated.stderr);
 return {checks,generatedCheck:generated.stdout.trim()};
});
const sources=sourcePaths.map(p=>({path:p,sha256:sha(path.join(root,p))}));
let reruns=null;const ix=process.argv.indexOf('--mirror');
if(ix>=0){const mirror=path.resolve(process.argv[ix+1]);const remediation=JSON.parse(fs.readFileSync(path.join(mirror,'docs/reviews/comprehensive-design-readiness-20261112.remediation.evidence.json'),'utf8'));const regressions=JSON.parse(fs.readFileSync(path.join(mirror,'docs/reviews/comprehensive-design-readiness-20261112.remediation.regression.json'),'utf8'));
 for(const source of sources)assert.equal(remediation.sources.find(s=>s.path===source.path)?.sha256,source.sha256,'Wrong rerun input '+source.path);assert.equal(regressions.exitCode,0);for(const source of sources.slice(0,6))assert.equal(regressions.sources.find(s=>s.path===source.path)?.sha256,source.sha256,'Wrong historical regression input '+source.path);reruns={mirror,remediation,regressions};}
for(const [p,h]of Object.entries(before))assert.equal(sha(p),h,'Protected file changed: '+p);
const result={review:'comprehensive-readiness-round2-bounded',date:'2026-11-12',timezone:'Asia/Shanghai',runtime:process.version,typescript:ts.version,sources,observations,reruns,
 closure:{closed:['RD-01','RD-03','RD-04','RD-05','RD-06','RD-07','RD-09'],partial:[{id:'RD-02',originalTimezoneShift:'fixed',remaining:'RR2-01, audit repository consumer migration',priority:'P2'}],decisionGate:['RD-08']},
 summary:{groups:observations.length,holds:observations.filter(o=>o.holds).length,violated:observations.filter(o=>!o.holds).length,remainingP1:0,remainingP2:1},
 protectedFileCount:protectedFiles.length,protectedFilesUnchanged:true,boundaries:{realMysql:false,realHttp:false,browser:false,wholeProjectBuild:false,productSignoff:false,sourceDocumentsModified:false}};
const out=path.join(__dirname,prefix+'.evidence.json');fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({summary:result.summary,closure:result.closure,remaining:observations.filter(o=>!o.holds),output:out},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
