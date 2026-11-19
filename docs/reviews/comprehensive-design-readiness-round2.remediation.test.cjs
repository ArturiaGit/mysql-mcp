'use strict';
// Positive RR2-01 checks. Historical scripts/evidence are read-only; no DB connections.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),ts=require('typescript');
const root=path.resolve(__dirname,'../..'),prefix='comprehensive-design-readiness-round2.remediation';
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const list=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?list(path.join(dir,e.name)):[path.join(dir,e.name)]);
const before=new Map(['docs','scripts'].flatMap(d=>list(path.join(root,d))).filter(p=>path.basename(p)!==prefix+'.evidence.json').map(p=>[p,sha(p)]));
const be=read('docs/BACKEND_ARCHITECTURE_SPEC.md');
function section(text,heading){const start=text.indexOf(heading);assert(start>=0,heading);const level=heading.match(/^#+/)[0].length,tail=text.slice(start+heading.length),end=new RegExp('\n#{1,'+level+'} ').exec(tail);return text.slice(start,end?start+heading.length+end.index:text.length);}
function code(heading,marker){const fence=String.fromCharCode(96).repeat(3);const m=[...section(be,heading).matchAll(new RegExp(fence+'typescript\n([\\s\\S]*?)'+fence,'g'))].find(m=>m[1].includes(marker));assert(m,marker);return m[1];}
const consumerPath='apps/admin-api/src/repositories/audit.repository.ts';
const graph={
 'packages/core-engine/src/metadata-pool.ts':code('### 4.2 ','export function createMetadataPool'),
 'packages/core-engine/src/index.ts':code('### 4.2 ','// packages/core-engine/src/index.ts'),
 [consumerPath]:code('### 10.3 ','export async function queryAuditLogs'),
 'apps/admin-api/src/services/audit-query.service.ts':code('### 10.3 ','export function createAuditQueryService'),
};
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mysql-mcp-rr2-01-'));
for(const [file,source]of Object.entries(graph)){const p=path.join(temp,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,source);}
fs.writeFileSync(path.join(temp,'caller.ts'),[
 "import type mysql2 from 'mysql2/promise';",
 "import { createMetadataQueryExecutor } from '@mysql-mcp/core-engine';",
 "import { queryAuditLogs } from './apps/admin-api/src/repositories/audit.repository';",
 "import { createAuditQueryService } from './apps/admin-api/src/services/audit-query.service';",
 'declare const rawPool: mysql2.Pool;',
 'const queries = createMetadataQueryExecutor(rawPool);',
 "const filter = { query_instance_id: 'qry-fixture', page: 1, pageSize: 20 };",
 'void queryAuditLogs(queries, filter);',
 'void createAuditQueryService({ metadataQueries: queries }).query(filter);',
].join('\n'));
function compile(consumer=graph[consumerPath]){
 const target=path.join(temp,consumerPath);fs.writeFileSync(target,consumer);
 try{
  const opts={strict:true,noEmit:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,moduleResolution:ts.ModuleResolutionKind.Node10,esModuleInterop:true,types:['node'],typeRoots:[path.dirname(path.dirname(require.resolve('@types/node/package.json')))],baseUrl:temp,paths:{'@mysql-mcp/core-engine':[path.join(temp,'packages/core-engine/src/index.ts')],'mysql2/promise':[require.resolve('mysql2/promise').replace(/\.js$/,'.d.ts')]}};
  return ts.getPreEmitDiagnostics(ts.createProgram([path.join(temp,'caller.ts')],opts)).map(d=>({code:d.code,file:d.file?path.relative(temp,d.file.fileName):null,line:d.file&&d.start!==undefined?d.file.getLineAndCharacterOfPosition(d.start).line+1:null,message:ts.flattenDiagnosticMessageText(d.messageText,'\n')}));
 }finally{fs.writeFileSync(target,graph[consumerPath]);}
}
// Execute the extracted graph with its imports, public barrel and call chain intact.
const cache=new Map();
function load(file){
 if(cache.has(file))return cache.get(file);assert(Object.hasOwn(graph,file),file);
 const exports={};cache.set(file,exports);
 const requireModule=id=>{
  if(id==='@mysql-mcp/core-engine')return load('packages/core-engine/src/index.ts');
  if(id==='mysql2/promise')return {createPool(){throw Error('Real pool creation prohibited in this test');}};
  if(id.startsWith('.'))return load(path.posix.normalize(path.posix.join(path.posix.dirname(file),id))+'.ts');
  throw Error('Unexpected dependency: '+id);
 };
 vm.runInNewContext(ts.transpileModule(graph[file],{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,{exports,require:requireModule},{filename:file,timeout:3000});return exports;
}
const {createMetadataQueryExecutor}=load('packages/core-engine/src/index.ts');
const {createAuditQueryService}=load('apps/admin-api/src/services/audit-query.service.ts');
function fixture({setGate,setError,sqlError,borrowError,rows=[{id:'9007199254740993',query_instance_id:'qry-1'}]}={}){
 const events=[],params=[];
 const conn={async query(sql,values){
  if(sql==="SET SESSION time_zone = '+00:00'"){events.push('SET-start');if(setGate)await setGate;if(setError)throw setError;events.push('SET-done');return [[],[]];}
  assert.equal(sql,'SELECT * FROM sys_audit_logs WHERE query_instance_id = ? LIMIT 1');events.push('SELECT');params.push(values);if(sqlError)throw sqlError;return [rows,[]];
 },release(){events.push('release');},destroy(){events.push('destroy');}};
 const pool={async getConnection(){events.push('borrow');if(borrowError)throw borrowError;return conn;},async query(){throw Error('Raw pool query bypassed UTC initialization');}};
 return {service:createAuditQueryService({metadataQueries:createMetadataQueryExecutor(pool)}),events,params,rows};
}
const tests=[];
async function test(name,fn){const result=await fn();tests.push({name,passed:true,result});console.log('PASS '+name);}
function run(command,args,cwd=root){const r=spawnSync(command,args,{cwd,encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'}});assert.equal(r.status,0,r.stdout+r.stderr+(r.error?.message??''));return {command:[command,...args],stdout:r.stdout.trim(),stderr:r.stderr.trim()};}
async function main(){

 await test('RR2-01 public module -> safe factory -> service -> Repository strict typecheck',()=>{
  const diagnostics=compile();assert.deepEqual(diagnostics,[]);
  const host=section(be,'### 1.2 ');assert(host.includes('const metadataQueries = createMetadataQueryExecutor(metadataPool)'));assert(host.includes('    metadataQueries,'));assert(host.includes('buildAdminServer(runtimeCtx)'));
  assert(graph[consumerPath].includes('queries: MetadataQueryExecutor'));assert(graph[consumerPath].includes("import type { RowDataPacket } from 'mysql2/promise'"));
  return {typescript:ts.version,mysql2:require('mysql2/package.json').version,diagnostics,modules:Object.keys(graph),boundary:'Actual extracted modules and mysql2 declarations; aliases resolved with tsconfig paths only'};
 });
 await test('Negative controls reject missing namespace, import-only Pool fix and wrong module path',()=>{
  const namespace=compile(graph[consumerPath].replace('queries.query<RowDataPacket[]>','queries.query<mysql2.RowDataPacket[]>'));assert(namespace.some(d=>d.code===2503&&d.message.includes('mysql2')));
  const poolOnly=compile("import type mysql2 from 'mysql2/promise';\n"+graph[consumerPath].replace('queries: MetadataQueryExecutor','queries: mysql2.Pool'));assert(poolOnly.some(d=>d.code===2345&&d.message.includes('MetadataQueryExecutor')));
  const wrongPath=compile(graph[consumerPath].replace("from '@mysql-mcp/core-engine'","from './metadata-pool'"));assert(wrongPath.some(d=>d.code===2307&&d.message.includes('./metadata-pool')));
  assert.deepEqual(compile(),[]);return {namespace,poolOnly,wrongPath,mutations:'Temporary extracted modules only; workspace sources unchanged'};
 });
 await test('Audit SELECT waits for UTC; parameters, response and per-borrow initialization preserved',async()=>{
  let resolveSet;const setGate=new Promise(resolve=>{resolveSet=resolve;});const f=fixture({setGate});let settled=false;
  const result=f.service.query({query_instance_id:' qry-1 ',page:8,pageSize:20}).then(r=>{settled=true;return r;});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.events,['borrow','SET-start']);assert(!settled);
  resolveSet();const output=await result;assert.deepEqual(f.events,['borrow','SET-start','SET-done','SELECT','release']);assert.equal(output.items,f.rows);assert.equal(output.total,1);assert.equal(output.page,1);assert.equal(output.pageSize,1);assert.equal(output.items[0].id,'9007199254740993');assert.equal(f.params[0][0],'qry-1');
  f.events.length=0;await f.service.query({query_instance_id:"qry-' OR 1=1 --",page:1,pageSize:1});assert.deepEqual(f.events,['borrow','SET-start','SET-done','SELECT','release']);assert.equal(f.params[1][0],"qry-' OR 1=1 --");
  return {secondBorrow:f.events,boundary:'Documented query service/Repository/executor with controlled promise connection; no MySQL server'};
 });
 await test('Audit SQL failure propagates original error and releases exactly once',async()=>{
  const error=new Error('controlled SELECT failure'),f=fixture({sqlError:error});await assert.rejects(f.service.query({query_instance_id:'qry-1',page:1,pageSize:20}),e=>e===error);assert.deepEqual(f.events,['borrow','SET-start','SET-done','SELECT','release']);return f.events;
 });
 await test('UTC failure destroys without querying/releasing; checkout failure does not use connection',async()=>{
  const error=new Error('controlled UTC failure'),f=fixture({setError:error});await assert.rejects(f.service.query({query_instance_id:'qry-1',page:1,pageSize:20}),e=>e===error);assert.deepEqual(f.events,['borrow','SET-start','destroy']);
  const borrowError=new Error('controlled checkout failure'),g=fixture({borrowError});await assert.rejects(g.service.query({query_instance_id:'qry-1',page:1,pageSize:20}),e=>e===borrowError);assert.deepEqual(g.events,['borrow']);return {initializationFailure:f.events,checkoutFailure:g.events};
 });
 await test('No-row response and existing pagination placeholder stay unchanged',async()=>{
  const f=fixture({rows:[]});const empty=await f.service.query({query_instance_id:'missing',page:3,pageSize:9});assert.equal(empty.items.length,0);assert.equal(empty.total,0);assert.equal(empty.page,1);assert.equal(empty.pageSize,1);
  f.events.length=0;const placeholder=await f.service.query({page:3,pageSize:9});assert.equal(placeholder.items.length,0);assert.equal(placeholder.total,0);assert.equal(placeholder.page,3);assert.equal(placeholder.pageSize,9);assert.deepEqual(f.events,[]);return {boundary:'General pagination remains an explicit placeholder, not a completed implementation'};
 });
 await test('Backend assembly, contract generation and unsigned RD-08 remain consistent',()=>{
  const names=fs.readdirSync(path.join(root,'scripts/be_parts')).filter(n=>/^part\d+_.*\.md$/.test(n)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));assert.equal(names.map(n=>read('scripts/be_parts/'+n).trim()).join('\n\n---\n\n'),be);
  const generated=run('python',['scripts/generate_readiness_contracts.py','--check']),db=read('docs/DATABASE_DESIGN_SPEC.md');
  for(const text of ['未签署前不冻结联调基线','新库暂取10，旧15不自动覆盖','冲突待澄清','建议向上取整'])assert(db.includes(text),text);return {generated,decisionGate:'RD-08 remains pending; no product approval inferred'};
 });
 const regressions={};
 if(process.argv.includes('--regressions')){
  regressions.databaseStatic=run('python',['scripts/validate_database_design.py']);
  regressions.validatorMutation=run('python',['-m','unittest','discover','-s','scripts','-p','test_validate_database_design.py']);
  const mirror=path.join(temp,'regression-workspace');fs.mkdirSync(mirror);for(const dir of ['docs','scripts'])fs.cpSync(path.join(root,dir),path.join(mirror,dir),{recursive:true});
  regressions.previousPositiveRun=run(process.execPath,['docs/reviews/comprehensive-design-readiness-20261112.remediation.test.cjs'],mirror);
  regressions.previousPositiveEvidence=JSON.parse(fs.readFileSync(path.join(mirror,'docs/reviews/comprehensive-design-readiness-20261112.remediation.evidence.json'),'utf8'));
  assert.equal(regressions.previousPositiveEvidence.summary.passed,15);for(const source of regressions.previousPositiveEvidence.sources)assert.equal(sha(path.join(root,source.path)),source.sha256);
 }
 for(const [file,digest]of before)assert.equal(sha(file),digest,'Protected file changed: '+file);
 const sourcePaths=['docs/BACKEND_ARCHITECTURE_SPEC.md','scripts/be_parts/part1_intro.md','scripts/be_parts/part4_database_and_dal.md','scripts/be_parts/part10_audit_and_stats.md','docs/DATABASE_DESIGN_SPEC.md','docs/contracts/readiness.types.ts','docs/reviews/'+prefix+'.test.cjs'];
 const evidence={date:'2026-11-12',timezone:'Asia/Shanghai',runtime:process.version,typescript:ts.version,sources:sourcePaths.map(p=>({path:p,sha256:sha(path.join(root,p))})),tests,regressions,summary:{total:tests.length,passed:tests.length,failed:0},closure:{RR2_01:'closed at design/snippet level',RD_02:'remaining consumer migration verified',RD_08:'pending responsible-owner decisions/signoff'},temporaryWorkspace:temp,protectedFilesUnchanged:true,protectedFileCount:before.size,boundaries:{realMysql:false,realHttp:false,browser:false,wholeProjectBuild:false,productSignoff:false,generalPaginationImplemented:false}};
 const output=path.join(__dirname,prefix+'.evidence.json');fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({summary:evidence.summary,previousPositive:regressions.previousPositiveEvidence?.summary,evidence:output}));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
