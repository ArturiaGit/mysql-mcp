'use strict';
// Bounded closure review. Reuses extraction/compiler/module-loader helpers, not remediation assertions.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..'),prefix='comprehensive-design-readiness-round3';
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function files(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(d,e.name)):[path.join(d,e.name)]);}
const protectedFiles=['docs','scripts'].flatMap(d=>files(path.join(root,d))).filter(p=>!path.basename(p).startsWith(prefix)&&path.basename(p)!=='COMPREHENSIVE_DESIGN_READINESS_REVIEW_ROUND3.md');
const before=new Map(protectedFiles.map(p=>[p,hash(p)]));
const previous=JSON.parse(read('docs/reviews/comprehensive-design-readiness-round2.evidence.json'));
const sources=previous.sources.map(s=>({path:s.path,sha256:hash(path.join(root,s.path)),unchangedSinceRound2:hash(path.join(root,s.path))===s.sha256}));
const helperFile=path.join(__dirname,'comprehensive-design-readiness-round2.remediation.test.cjs');
const helperSource=fs.readFileSync(helperFile,'utf8').replace(/^\uFEFF/,'');
const cut=helperSource.indexOf('function fixture(');assert(cut>0);
const mod={exports:{}};
new Function('require','module','__dirname',helperSource.slice(0,cut)+'\nmodule.exports={compile,graph,createMetadataQueryExecutor,createAuditQueryService,temp};')(createRequire(helperFile),mod,__dirname);
const {compile,graph,createMetadataQueryExecutor:factory,createAuditQueryService:serviceFactory,temp}=mod.exports;
const repo='apps/admin-api/src/repositories/audit.repository.ts',observations=[];
async function test(name,fn){const detail=await fn();observations.push({name,passed:true,detail});console.log('PASS '+name);}
async function main(){
await test('Only backend changed among nine tracked source artifacts',()=>{
 assert.deepEqual(sources.filter(s=>!s.unchangedSinceRound2).map(s=>s.path),['docs/BACKEND_ARCHITECTURE_SPEC.md']);return {changed:'backend v1.7.3',unchanged:8};
});
await test('Current four-module source graph compiles and rejects both former failure modes',()=>{
 const diagnostics=compile();assert.deepEqual(diagnostics,[]);
 const missing=graph[repo].replace("import type { RowDataPacket } from 'mysql2/promise';",'').replace('queries: MetadataQueryExecutor','queries: mysql2.Pool').replace('queries.query<RowDataPacket[]>','queries.query<mysql2.RowDataPacket[]>');
 const missingDiagnostics=compile(missing);assert.equal(missingDiagnostics.filter(d=>d.code===2503).length,2);
 const importOnlyDiagnostics=compile("import type mysql2 from 'mysql2/promise';\n"+missing);assert(importOnlyDiagnostics.some(d=>d.code===2345));
 return {diagnostics,missingDiagnostics,importOnlyDiagnostics,boundary:'Real TypeScript/mysql2 declarations, verbatim four modules; reused compiler helper, independent assertions'};
});
await test('Concurrent service calls isolate their UTC initialization and release on mixed success/failure',async()=>{
 const trace=[],calls=[];let openFirst;const gate=new Promise(r=>{openFirst=r;});const error=new Error('first SELECT failed');let n=0;
 const connections=[0,1].map(i=>({query:async(sql,params)=>{if(sql.startsWith('SET SESSION')){trace.push(`${i}:SET-start`);if(i===0)await gate;trace.push(`${i}:SET-done`);return [[],[]];}trace.push(`${i}:SELECT`);calls.push({i,sql,params});if(i===0)throw error;return [[{id:'9007199254740993'}],[]];},release:()=>trace.push(`${i}:release`),destroy:()=>trace.push(`${i}:destroy`)}));
 const pool={getConnection:async()=>{const i=n++;trace.push(`${i}:borrow`);assert(i<2);return connections[i];},query:()=>{throw Error('raw Pool bypass');}};
 const service=serviceFactory({metadataQueries:factory(pool)});
 const first=service.query({query_instance_id:'  q-first  ',page:1,pageSize:20}).then(()=>null,e=>e);
 await new Promise(r=>setImmediate(r));assert(!trace.includes('0:SELECT'));
 const second=await service.query({query_instance_id:"q-' OR 1=1 --",page:3,pageSize:30});assert.equal(second.items[0].id,'9007199254740993');assert.equal(second.page,1);assert.equal(second.total,1);assert(!trace.includes('0:SELECT'));
 openFirst();assert.equal(await first,error);for(const i of [0,1])assert.equal(trace.filter(x=>x===`${i}:release`).length,1);assert(!trace.some(x=>x.endsWith(':destroy')));
 assert.equal(calls.find(c=>c.i===0).params[0],'q-first');assert.equal(calls.find(c=>c.i===1).params[0],"q-' OR 1=1 --");assert(calls.every(c=>!c.sql.includes('OR 1=1')));
 return {trace,calls,boundary:'Original four-module chain; controlled pool, not MySQL integration'};
});
await test('Failed UTC setup destroys the connection; next service call uses a fresh initialized connection',async()=>{
 const trace=[],error=new Error('SET denied');let n=0;
 const pool={getConnection:async()=>{const i=n++;trace.push(`${i}:borrow`);return {query:async(sql)=>{trace.push(`${i}:${sql.startsWith('SET SESSION')?'SET':'SELECT'}`);if(i===0)throw error;return [[{id:'9007199254740993'}],[]];},release:()=>trace.push(`${i}:release`),destroy:()=>trace.push(`${i}:destroy`)};},query:()=>{throw Error('raw Pool bypass');}};
 const service=serviceFactory({metadataQueries:factory(pool)}),filter={query_instance_id:'qry-next',page:1,pageSize:20};
 await assert.rejects(service.query(filter),e=>e===error);const result=await service.query(filter);assert.equal(result.items[0].id,'9007199254740993');
 assert.deepEqual(trace,['0:borrow','0:SET','0:destroy','1:borrow','1:SET','1:SELECT','1:release']);return {trace};
});
await test('Backend assembly and generated artifacts are synchronized',()=>{
 const names=fs.readdirSync(path.join(root,'scripts/be_parts')).filter(n=>/^part\d+_.*\.md$/.test(n)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
 assert.equal(names.map(n=>read('scripts/be_parts/'+n).trim()).join('\n\n---\n\n'),read('docs/BACKEND_ARCHITECTURE_SPEC.md'));
 const result=require('node:child_process').spawnSync('python',['scripts/generate_readiness_contracts.py','--check'],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return {stdout:result.stdout,stderr:result.stderr};
});
await test('RD-08 decision and signoff gate remains explicitly pending',()=>{
 const db=read('docs/DATABASE_DESIGN_SPEC.md'),phrases=['未签署前不冻结联调基线','新库暂取10，旧15不自动覆盖','冲突待澄清','建议向上取整'];for(const p of phrases)assert(db.includes(p),p);return {phrases,externalApprovalInferred:false};
});
const pos=process.argv.indexOf('--mirror');assert(pos>=0&&process.argv[pos+1],'Pass --mirror with the fresh remediation evidence root');
const mirror=path.resolve(process.argv[pos+1]),mirrorEvidence=path.join(mirror,'docs/reviews/comprehensive-design-readiness-round2.remediation.evidence.json');
const rerun=JSON.parse(fs.readFileSync(mirrorEvidence,'utf8').replace(/^\uFEFF/,''));
for(const s of [...rerun.sources,...rerun.regressions.previousPositiveEvidence.sources])assert.equal(hash(path.join(root,s.path)),s.sha256,'Fresh run source mismatch: '+s.path);
assert.equal(rerun.summary.total,7);assert.equal(rerun.summary.passed,7);assert.equal(rerun.regressions.previousPositiveEvidence.summary.passed,15);
for(const [p,h]of before)assert.equal(hash(p),h,'Protected file changed: '+p);
const evidence={date:'2026-11-12',timezone:'Asia/Shanghai',runtime:process.version,typescript:require('typescript').version,sources,observations,summary:{total:observations.length,passed:observations.length,failed:0},closure:{RR2_01:'closed at design/snippet level',RD_02:'closed within original technical scope',RD_08:'pending owner decisions/signoff'},method:'Reuse counterpart extraction/compiler/module-loader helpers; independent assertions including concurrent mixed outcomes and recovery after UTC setup failure. Fresh rerun source hashes verified.',rerun,rerunEvidenceSha256:hash(mirrorEvidence),temporaryWorkspace:temp,protectedFilesUnchanged:true,protectedFileCount:before.size,boundaries:{realMysql:false,realHttp:false,browser:false,wholeProjectBuild:false,productSignoff:false,historical96SuiteRerun:false}};
const output=path.join(__dirname,prefix+'.evidence.json');fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({summary:evidence.summary,evidence:output}));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
