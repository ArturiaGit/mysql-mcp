'use strict';
// Positive design/snippet tests. No MySQL server, HTTP implementation, or browser is simulated as real.
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const vm=require('node:vm'), crypto=require('node:crypto'), ts=require('typescript');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const be=read('docs/BACKEND_ARCHITECTURE_SPEC.md'), fe=read('docs/FRONTEND_ARCHITECTURE_SPEC.md');
const api=read('docs/API_CONTRACT_SPEC.md'), db=read('docs/DATABASE_DESIGN_SPEC.md');
const arch=read('docs/ARCHITECTURE_SPEC.md'), ddl=read('docs/sql/001_metadata_schema.sql');
const tests=[];
function section(text,heading){const start=text.indexOf(heading);assert(start>=0,heading);const level=heading.match(/^#+/)[0].length;const tail=text.slice(start+heading.length);const m=new RegExp('\\n#{1,'+level+'} ').exec(tail);return text.slice(start,m?start+heading.length+m.index:text.length);}
function code(text,heading,needle){const b=[...section(text,heading).matchAll(/```(?:typescript|ts)\n([\s\S]*?)```/g)].find(m=>m[1].includes(needle));assert(b,needle);return b[1];}
async function test(name,fn){try{const detail=await fn();tests.push({name,passed:true,detail});console.log('PASS '+name);}catch(e){tests.push({name,passed:false,error:e.stack});throw e;}}
function load(source,globals={}){const text=source.replace(/^import .*;\n/gm,'');const exports={};const context={exports,console,Buffer,crypto,...globals};vm.runInNewContext(ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context,{timeout:3000});return exports;}
function compile(text){const file=path.join(root,'__readiness_virtual__.ts');const opts={strict:true,noEmit:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,moduleResolution:ts.ModuleResolutionKind.Node10,esModuleInterop:true,types:['node'],typeRoots:[path.dirname(path.dirname(require.resolve('@types/node/package.json')))]};const host=ts.createCompilerHost(opts),old=host.getSourceFile.bind(host);host.getSourceFile=(f,v,...rest)=>path.resolve(f)===file?ts.createSourceFile(f,text,v,true):old(f,v,...rest);return ts.getPreEmitDiagnostics(ts.createProgram([file],opts,host)).map(d=>({code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,'\n')}));}
const types=read('docs/contracts/readiness.types.ts'), fixtures=JSON.parse(read('docs/contracts/readiness.fixtures.json'));
const poolCode=code(be,'### 4.2 ','createMetadataPool');
class AppError extends Error {constructor(p){super(p.message);Object.assign(this,p);}}

async function main(){
await test('RD-01 shared allocation SQL and complete revision lifecycle',()=>{
 const text=section(api,'#### 6.7.4 '), sql=text.match(/```sql\n([\s\S]*?)```/)[1];
 assert(!sql.includes('user_quota_qpm'));assert(sql.includes('SET last_revision = last_revision + 1'));
 assert(sql.indexOf('UPDATE sys_rate_limit_revisions')<sql.indexOf('INSERT INTO sys_rate_limits ('));
 assert(sql.indexOf('UPDATE sys_rate_limit_revisions')<sql.indexOf('UPDATE sys_rate_limits SET'));
 assert(/revision = \?, version = \?/.test(sql));assert(sql.includes('4294967295'));
 assert(sql.indexOf('FROM sys_users')<sql.indexOf('FROM sys_rate_limit_revisions'));
 assert(text.includes('同事务')&&text.includes('审计')&&text.includes('ROLLBACK'));
 // SQL-guided serialized state model. The shared UPDATE allocates for BOTH branches.
 let counter=0,revision=null;const states=[];
 function put(expected,failAudit=false){const old={counter,revision};if((expected===0?revision!==null:revision!==expected)||counter===4294967295)return false;counter++;revision=counter;if(failAudit){({counter,revision}=old);return false;}states.push({counter,revision});return true;}
 function del(expected){if(expected<=0||revision!==expected)return false;revision=null;return true;}
 assert(put(0));assert(put(1));assert(put(2));assert(del(3));assert(put(0));assert.equal(revision,4);
 for(const n of [1,2,3]){assert(!put(n));assert(!del(n));}
 assert(!put(4,true));assert.equal(counter,4);assert.equal(revision,4);
 assert(!del(0));counter=4294967295;revision=counter;assert(!put(revision));
 return {states,boundary:'SQL-guided sequential model; not database concurrency'};
});
await test('RD-02 UTC parser, serialization, milliseconds and display boundary',()=>{
 const tz=poolCode.match(/timezone:\s*'([^']+)'/)[1];assert.equal(tz,'Z');
 const mysqlRoot=path.dirname(require.resolve('mysql2/package.json'));const Packet=require(path.join(mysqlRoot,'lib/packets/packet.js'));
 const value=Buffer.from('2026-11-12 08:00:00.123'),raw=Buffer.concat([Buffer.alloc(4),Buffer.from([value.length]),value]);
 const date=new Packet(0,raw,0,raw.length).parseDateTime(tz);assert.equal(date.toISOString(),'2026-11-12T08:00:00.123Z');
 const sql=require('mysql2').escape(date,false,tz);assert.equal(sql,"'2026-11-12 08:00:00.123'");
 const display=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(date);assert.equal(display,'16:00:00');
 assert(!/DATETIME(?!\(3\))/.test(ddl));assert(!/NOW\(\)/.test(api));
 return {driver:require(path.join(mysqlRoot,'package.json')).version,iso:date.toISOString(),sql,display,boundary:'real mysql2 decoder/SQL encoder and Intl; no server/browser'};
});
await test('RD-02 await UTC initialization; destroy failed connection; initialize each borrow',async()=>{
 let releaseGate;const gate=new Promise(r=>{releaseGate=r;});const calls=[];const conn={query:async sql=>{calls.push(sql);await gate;},destroy(){calls.push('destroy');}};
 const m=load(poolCode);const pool={getConnection:async()=>conn};let resolved=false;
 const pending=m.acquireMetadataConnection(pool).then(c=>{resolved=true;return c;});await new Promise(r=>setImmediate(r));assert(!resolved);releaseGate();assert.equal(await pending,conn);
 await m.acquireMetadataConnection(pool);assert.equal(calls.length,2);assert(calls.every(x=>x==="SET SESSION time_zone = '+00:00'"));
 conn.query=async()=>{throw Error('session failure');};await assert.rejects(m.acquireMetadataConnection(pool),/session failure/);assert.equal(calls.at(-1),'destroy');
 const tx=load(code(be,'### 4.3 ','withTransaction'),{acquireMetadataConnection:async()=>{throw Error('UTC not initialized');},AppError});
 let invoked=false;await assert.rejects(tx.withTransaction(pool,async()=>{invoked=true;}),/UTC not initialized/);assert(!invoked);
});
await test('RD-02 nontransaction executor initializes and releases; startup wiring uses safe entrypoints',async()=>{
 const calls=[];const conn={async query(sql){calls.push(sql);if(sql==='FAIL')throw Error('query failure');return [[{ok:true}],[]];},release(){calls.push('release');},destroy(){calls.push('destroy');}};
 const m=load(poolCode),executor=m.createMetadataQueryExecutor({getConnection:async()=>conn});
 await executor.query('SELECT 1');assert.deepEqual(calls,["SET SESSION time_zone = '+00:00'",'SELECT 1','release']);
 calls.length=0;await assert.rejects(executor.query('FAIL'),/query failure/);assert.equal(calls.at(-1),'release');
 const host=section(be,'### 1.2 ');assert(host.includes('new RegistryHub(metadataQueries)'));assert(host.includes('new AuditEngine(metadataQueries,'));
 assert(host.includes('new BootstrapService(metadataPool, config, keyring, deliverInitialPassword)'));
 const actualMysql=poolCode.replace("'mysql2/promise'",JSON.stringify(require.resolve('mysql2/promise').replaceAll('\\','/')));
 assert.deepEqual(compile(actualMysql),[]); // Actual mysql2 declaration compatibility, not typed fake pool.
});
await test('RD-03 single physical schema and original constraints retained',()=>{
 assert(!/CREATE TABLE/.test(section(be,'### 4.1 ')));assert(!/CREATE TABLE/.test(section(arch,'### 5.2 ')));
 for(const doc of [be,arch])assert(doc.includes('docs/sql/001_metadata_schema.sql'));
 assert.equal([...ddl.matchAll(/CREATE TABLE `/g)].length,14);
 for(const token of ['sys_rate_limit_revisions','`application_reason`','`pending_user_id`','`decided_at`','`target_type`','`target_id`','`details`','ON DELETE RESTRICT','utf8mb4_0900_as_cs','VARCHAR(128)'])assert(ddl.includes(token),token);
});
await test('RD-04 actual contract fixture compiles; mapper round-trip; no secret/read-only write leak',()=>{
 const mapper=code(fe,'### 8.2 ','profileToEditForm').match(/export function profileToEditForm[\s\S]*$/)[0];
 const p=fixtures.profiles[0];const text=types+'\n'+mapper+'\nconst p: ProfileReadDTO = '+JSON.stringify(p)+';\nconst update: UpdateProfilePayload = profileToEditForm(p);';
 assert.deepEqual(compile(text),[]);
 const {profileToEditForm}=load(types+'\n'+mapper);const form=profileToEditForm(p);
 assert.equal(form.user,p.username);for(const key of ['username','password','ssh_private_key','created_at','updated_at','id','status','name','environment'])assert(!Object.hasOwn(form,key),key);
 const legacy=types.replace('  username: string;','  user: string;');assert(compile(legacy+'\nconst p: ProfileReadDTO = '+JSON.stringify(p)+';').length>0);
 return {typescript:ts.version,username:form.user,diagnostics:0};
});
await test('RD-05 generated request signatures and negative type mutations',()=>{
 for(const [name,fixture]of Object.entries(fixtures)){if(name==='profiles')continue;assert.deepEqual(compile(types+'\nconst p: '+name+' = '+JSON.stringify(fixture)+';'),[],name);}
 const good={defaultUserQuotaQpm:60,burstCapacity:10,agentLoopThreshold:3,agentLoopWindowSec:30,version:1};
 const bad={...good};delete bad.burstCapacity;assert(compile(types+'\nconst p: GlobalRateLimitPayload = '+JSON.stringify(bad)+';').length>0);
 assert(compile(types+'\nconst p: ExportAuditPayload = {range:"today",profileId:"1"};').length>0);
 assert.deepEqual(compile(types+'\nconst p: TestSshPayload = {host:"host",username:"reader",privateKey:"key",hostFingerprintSha256:"SHA256:fixture"};'),[]);
 for(const doc of [be,fe]){const row=doc.split('\n').find(l=>l.startsWith('|')&&l.includes('`/api/v1/audits/export`'));assert(row.includes('profile_id'));assert(!row.includes('profileId'));}
});
await test('RD-06 exact 47 method/path coverage and implementation trace',()=>{
 const canonical=[...api.matchAll(/\*\*接口路径\*\*：`([A-Z]+ \/api\/v1\/[^`]+)`/g)].map(m=>m[1]).sort();assert.equal(canonical.length,47);
 for(const doc of [section(fe,'### 8.1 '),section(be,'### 11.1 ')]){const mapped=[];for(const m of doc.matchAll(/`(\/api\/v1\/[^`]+)`\s*\|\s*`([A-Z/]+)`/g))for(const verb of m[2].split('/'))mapped.push(verb+' '+m[1]);assert.deepEqual(mapped.sort(),canonical);}
 const trace=JSON.parse(read('docs/contracts/endpoint-trace.json'));assert.equal(trace.length,47);for(const row of trace)for(const field of ['schema','controller','service','repository','guard','frontend','acceptance'])assert(row[field]);
});
await test('RD-07 extracted guard: role/users/bindings lock order; last admin and self protection',async()=>{
 const {UserService}=load(code(be,'### 4.4 ','class UserService'),{AppError,toEntityId:x=>String(x)});const svc=new UserService({}, {}, {});
 let users=[{id:'1',status:'ACTIVE'}],bindings=[{user_id:'1'}];const calls=[];
 const conn={query:async sql=>{calls.push(sql);if(sql.includes('FROM sys_roles'))return [[{id:'9'}]];if(sql.includes('FROM sys_users'))return [users];if(sql.includes('FROM sys_user_roles'))return [bindings];throw Error(sql);}};
 await assert.rejects(svc.guardLastSuperAdminInTx(conn,'1','2',x=>x),e=>e.code==='ERR_LAST_SUPER_ADMIN');
 assert(calls[0].includes('FROM sys_roles'));assert(calls[1].includes('FROM sys_users'));assert(calls[2].includes('FROM sys_user_roles'));assert(calls.every(x=>x.includes('FOR UPDATE')));
 users.push({id:'2',status:'ACTIVE'});bindings.push({user_id:'2'});await svc.guardLastSuperAdminInTx(conn,'1','2',x=>x);
 await assert.rejects(svc.guardLastSuperAdminInTx(conn,'1','1',x=>x),e=>e.code==='ERR_SELF_ACTION_PROHIBITED');
 await svc.guardLastSuperAdminInTx(conn,'1','1',()=>false); // unrelated own role edit must not be blocked
 assert(section(api,'### 5.4 ').includes("role_name = 'SUPER_ADMIN' FOR UPDATE"));
 return {boundary:'documented guard on controlled current-read rows; not an InnoDB scheduler'};
});
const bootstrapCode=code(be,'### 5.1 ','class BootstrapService');
await test('RD-09 bootstrap snippet strict typecheck with actual mysql2 types',()=>{
 const source=bootstrapCode.replace("'mysql2/promise'",JSON.stringify(require.resolve('mysql2/promise').replaceAll('\\','/')))
   .replace("import { hashPassword } from '@mysql-mcp/security';",'declare function hashPassword(password: string): Promise<string>;')
   .replace("import { withTransaction } from '../repositories/base.repository';",'declare function withTransaction<T>(pool: mysql2.Pool, fn: (conn: mysql2.PoolConnection) => Promise<T>): Promise<T>;');
 assert.deepEqual(compile(source),[]);
});
function bootFixture(options={}){
 let state={marker:'PENDING',users:[],roles:[],bindings:[],global:null,settings:null,audits:[],other:[],...options};const calls=[],delivered=[];
 const conn={query:async(sql,args=[])=>{calls.push({sql,args});
  if(sql.includes("SELECT setting_value FROM sys_system_settings WHERE setting_key = 'bootstrap_state'"))return [state.marker===null?[]:[{setting_value:state.marker}]];
  if(sql.startsWith('SELECT 1 FROM ??')){const table=args[0];const rows=table==='sys_rate_limits'?(state.global?[state.global]:[]):table==='sys_system_settings'?(state.settings?[state.settings]:[]):(state[({sys_users:'users',sys_roles:'roles',sys_user_roles:'bindings',sys_user_approvals:'audits'})[table]]??state.other);return [rows.slice(0,1)];}
  if(sql.includes('INSERT INTO sys_roles')){state.roles=[{id:'9'}];return [{affectedRows:5}];}
  if(sql.includes('SELECT id FROM sys_roles'))return [state.roles];
  if(sql.includes('SELECT id, status FROM sys_users'))return [state.users];
  if(sql.includes('SELECT user_id FROM sys_user_roles'))return [state.bindings];
  if(sql.includes('INSERT INTO sys_rate_limits')){assert(sql.includes("('GLOBAL', 0, 60, 10, 3, 30, 0, 1)"));state.global={id:'10',burst:10};return [{}];}
  if(sql.includes('SELECT id FROM sys_rate_limits'))return [state.global?[state.global]:[]];
  if(sql.includes('INSERT INTO sys_system_settings')){state.settings={setting_value:args[0],is_encrypted:1};return [{}];}
  if(sql.includes('SELECT setting_value, is_encrypted'))return [state.settings?[state.settings]:[]];
  if(sql.includes('INSERT INTO sys_users')){state.users.push({id:'9007199254740993',status:'ACTIVE',password:args[0]});return [{}];}
  if(sql.includes('LAST_INSERT_ID()'))return [[{id:'9007199254740993'}]];
  if(sql.includes('INSERT INTO sys_user_roles')){state.bindings.push({user_id:args[0]});return [{}];}
  if(sql.includes('INSERT INTO sys_user_approvals')){if(state.failAudit)throw Error('audit failed');assert(sql.includes("'CONFIG_UPDATE'"));state.audits.push({id:args[0]});return [{}];}
  if(sql.includes("SET setting_value = 'READY'")){state.marker='READY';return [{affectedRows:1}];}
  throw Error('Unexpected SQL: '+sql);
 }};
 const withTransaction=async(pool,fn)=>{const old=structuredClone(state);try{return await fn(conn);}catch(e){state=old;throw e;}};
 const keyring={encrypt:p=>'cipher:'+p,decrypt:p=>{if(!p.startsWith('cipher:'))throw Error('decrypt failed');return p.slice(7);}};
 const {BootstrapService}=load(bootstrapCode,{withTransaction,hashPassword:async p=>'hash:'+p});
 const service=new BootstrapService({}, {}, keyring,async p=>{assert.equal(state.marker,'READY');if(state.failDelivery)throw Error('delivery failed');delivered.push(p);});
 return {service,calls,delivered,get state(){return state;}};
}
await test('RD-09 first empty initialization and ordinary restart preserve identity/configuration',async()=>{
 const f=bootFixture();await f.service.ensureSystemInitialized();assert.equal(f.state.marker,'READY');assert.equal(f.state.users.length,1);assert.equal(f.state.bindings[0].user_id,'9007199254740993');assert.equal(f.state.audits.length,1);assert.equal(f.delivered.length,1);
 f.state.global.burst=15;const before=JSON.stringify(f.state);f.calls.length=0;await f.service.ensureSystemInitialized();assert.equal(JSON.stringify(f.state),before);assert(!f.calls.some(x=>/^\s*(INSERT|UPDATE)\b/.test(x.sql)));assert.equal(f.delivered.length,1);
});
await test('RD-09 missing marker, nonempty PENDING and absent active super-admin never create identity',async()=>{
 const ready={marker:'READY',roles:[{id:'9'}],global:{id:'10'},settings:{setting_value:'cipher:{}',is_encrypted:1}};
 for(const opts of [{marker:null},{marker:'BROKEN'},{global:{id:'10'}},{settings:{setting_value:'old',is_encrypted:1}},{users:[{id:'1',status:'DISABLED'}]},{...ready},{...ready,users:[{id:'1',status:'DISABLED'}],bindings:[{user_id:'1'}]},{...ready,users:[{id:'2',status:'ACTIVE'}]}]){
  const f=bootFixture(opts),before=JSON.stringify(f.state);await assert.rejects(f.service.ensureSystemInitialized(),/BOOTSTRAP_RECOVERY_REQUIRED/);assert.equal(JSON.stringify(f.state),before);assert(!f.calls.some(x=>/INSERT INTO sys_users/.test(x.sql)));assert.equal(f.delivered.length,0);
 }
});
await test('RD-09 audit rollback and post-commit secret delivery failure do not reissue admin',async()=>{
 const f=bootFixture({failAudit:true});await assert.rejects(f.service.ensureSystemInitialized(),/audit failed/);assert.equal(f.state.marker,'PENDING');assert.equal(f.state.users.length,0);assert.equal(f.delivered.length,0);f.state.failAudit=false;await f.service.ensureSystemInitialized();assert.equal(f.state.marker,'READY');
 const g=bootFixture({failDelivery:true});await assert.rejects(g.service.ensureSystemInitialized(),/delivery failed/);assert.equal(g.state.marker,'READY');assert.equal(g.state.users.length,1);await g.service.ensureSystemInitialized();assert.equal(g.state.users.length,1);
});
await test('RD-08 unsigned decisions remain explicit and are not represented as approved',()=>{
 assert(db.includes('未签署前不冻结联调基线'));assert(db.includes('新库暂取10，旧15不自动覆盖'));assert(db.includes('冲突待澄清'));assert(db.includes('建议向上取整'));
 assert(!fe.includes('通配符支持待后端确认'));assert(bootstrapCode.includes("('GLOBAL', 0, 60, 10, 3, 30, 0, 1)"));
});
await test('Generated parts, request types, fixtures and endpoint trace have no drift',()=>{
 for(const [dir,file]of [['arch_parts','ARCHITECTURE_SPEC'],['be_parts','BACKEND_ARCHITECTURE_SPEC'],['fe_parts','FRONTEND_ARCHITECTURE_SPEC'],['contract_parts','API_CONTRACT_SPEC']]){
  const names=fs.readdirSync(path.join(root,'scripts',dir)).filter(n=>/^part\d+_.*\.md$/.test(n)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
  assert.equal(names.map(n=>read('scripts/'+dir+'/'+n).trim()).join('\n\n---\n\n'),read('docs/'+file+'.md'));
 }
 const result=spawnSync('python',['scripts/generate_readiness_contracts.py','--check'],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stdout+result.stderr);
});
}
main().then(()=>{
 const paths=['docs/ARCHITECTURE_SPEC.md','docs/BACKEND_ARCHITECTURE_SPEC.md','docs/FRONTEND_ARCHITECTURE_SPEC.md','docs/API_CONTRACT_SPEC.md','docs/DATABASE_DESIGN_SPEC.md','docs/sql/001_metadata_schema.sql','docs/contracts/readiness.types.ts','docs/contracts/readiness.fixtures.json','docs/contracts/endpoint-trace.json'];
 const evidence={date:'2026-11-12',timezone:'Asia/Shanghai',runtime:process.version,typescript:ts.version,sources:paths.map(p=>({path:p,sha256:hash(p)})),tests,summary:{passed:tests.filter(t=>t.passed).length,total:tests.length},boundaries:{realMysql:false,realHttp:false,browser:false,wholeProjectBuild:false,productSignoff:false,method:'extracted snippets, actual TS compiler/mysql2 decoder, controlled SQL responses and sequential model'}};
 fs.writeFileSync(path.join(__dirname,'comprehensive-design-readiness-20261112.remediation.evidence.json'),JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify(evidence.summary));
}).catch(e=>{console.error(e.stack);process.exitCode=1;});


