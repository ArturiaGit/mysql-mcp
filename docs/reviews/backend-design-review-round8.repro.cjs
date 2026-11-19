/**
 * Round 8 bounded re-review: BE-R7-01 and BE-R7-02 ONLY.
 * Reuses round-7's two audit counterexamples, sealed-path control and limiter
 * semantic check without changing their assertions or scheduling barriers.
 * No broader 68-probe baseline and no new boundary probes are executed.
 * The old counterfactual "remove prev.now" control is retired after the fix;
 * it is not counted as another successful check of already-corrected code.
 * Real temporary filesystem; controlled MySQL; no production services.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const crypto = require('node:crypto');
const docPath = path.resolve(process.argv[2] || path.resolve(__dirname, '../BACKEND_ARCHITECTURE_SPEC.md'));
const docBytes = fs.readFileSync(docPath);
const doc = docBytes.toString('utf8');
class AppError extends Error { constructor(p) { super(p.message); Object.assign(this,p); } }
function load(marker, overrides={}) {
  const start = doc.indexOf('// '+marker);
  assert(start >= 0,marker);
  const end = doc.indexOf('\n```',start);
  const source=doc.slice(start,end);
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const m={exports:{}};
  new Function('require','module','exports',js)(id => {
    if(id in overrides)return overrides[id];
    if(id==='@mysql-mcp/core-engine'||id==='./app-error')return {AppError};
    return require(id);
  },m,m.exports);
  return m.exports;
}

const results={review:'round-8-bounded',reviewedAt:new Date().toISOString(),specPath:docPath,specSha256:crypto.createHash('sha256').update(docBytes).digest('hex'),specBytes:docBytes.length,specLines:doc.split('\n').length,scope:['BE-R7-01','BE-R7-02'],fullBaselineExecuted:false,environment:{node:process.version,typescript:ts.version,mysql2:require('mysql2/package.json').version},tests:[],retiredControls:[{name:'r7_limiter_without_undeclared_property_control',reason:'Counterfactual removal control is no longer needed after the real source removed the offending expression. Not counted as an executed observation.'}]};
const add=(name,expected,data)=>results.tests.push({name,invariantHolds:!!expected,...structuredClone(data)});
(async()=>{
for(const scenario of ['repeat-seal','seal-before-snapshot']) {
  const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'mysql-mcp-r7-lease-'));
  let phase='seed',active,signalDb,resumeDb,signalRead,resumeRead,firstRead=true;
  const dbStarted=new Promise(r=>signalDb=r),dbGate=new Promise(r=>resumeDb=r);
  const readStarted=new Promise(r=>signalRead=r),readGate=new Promise(r=>resumeRead=r);
  const reads=[],mysqlIds=[],acknowledged=[];
  const facade=scenario==='seal-before-snapshot'?{...fs,promises:{...fs.promises,readFile:async(...args)=>{
    if(firstRead&&String(args[0])===active){firstRead=false;signalRead();await readGate}
    const buffer=await fs.promises.readFile(...args);
    reads.push({path:path.basename(String(args[0])),ids:buffer.toString('utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l).queryInstanceId)});
    return buffer;
  }}}:fs;
  const {AuditEngine:Engine}=load('packages/core-engine/src/audit-engine.ts',{'node:fs':facade,'@mysql-mcp/security':{Masker:{maskSqlText:s=>s}}});
  const expectedReplayId=scenario==='repeat-seal'?'r7-A':'r7-B';
  const engine=new Engine({query:async(_sql,params)=>{
    const ids=params[0].map(row=>row[0]);
    if(phase==='seed'||ids.some(id=>id!==expectedReplayId))throw new Error('controlled DB fallback');
    if(scenario==='repeat-seal'){signalDb();await dbGate}
    mysqlIds.push(...ids);return [{}];
  }},{maxUnflushedEvents:100,batchSize:100,flushIntervalMs:10000,emergencyLogDir:dir});
  const submit=async(id,long=false)=>{const slot=await engine.reserveSlotOrBackpressure();await slot.commit({queryInstanceId:id,userId:'1',profileId:'1',sqlText:long?"SELECT '"+'x'.repeat(2048)+"'":'SELECT 1',isHighRisk:false});await engine.flushBatch();acknowledged.push(id)};
  await submit('r7-A',scenario==='repeat-seal');active=path.join(dir,fs.readdirSync(dir)[0]);phase='replay';
  const replay=engine.replayEmergencyLogsToDb(active);let sealedA,sealedB,redirectAfterFirst,redirectAfterSecond;
  if(scenario==='repeat-seal') {
    await dbStarted;sealedA=await engine.sealActiveEmergencyLog(active);redirectAfterFirst=engine.replayingSealedRedirects.get(path.resolve(active));
    await submit('r7-B');sealedB=await engine.sealActiveEmergencyLog(active);redirectAfterSecond=engine.replayingSealedRedirects.get(path.resolve(active));
    await submit('r7-C');resumeDb();
  } else {
    await readStarted;sealedA=await engine.sealActiveEmergencyLog(active);redirectAfterFirst=engine.replayingSealedRedirects.get(path.resolve(active));
    phase='seed';await submit('r7-B',true);phase='replay';resumeRead();
  }
  const replayed=await replay;
  const remainingFiles=fs.readdirSync(dir),fallbackIds=remainingFiles.flatMap(f=>fs.readFileSync(path.join(dir,f),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l).queryInstanceId));
  const lost=acknowledged.filter(id=>!mysqlIds.includes(id)&&!fallbackIds.includes(id));
  add('r7_replay_lease_'+scenario.replaceAll('-','_'),lost.length===0,{scenario,acknowledgedFallbackIds:acknowledged,replayed,mysqlDurableIds:mysqlIds,fallbackIds,lostEventIds:lost,sealedA:path.basename(sealedA),sealedB:sealedB?path.basename(sealedB):null,redirectAfterFirst:redirectAfterFirst?path.basename(redirectAfterFirst):null,redirectAfterSecond:redirectAfterSecond?path.basename(redirectAfterSecond):null,readObservations:reads,remainingFiles,totalUnflushed:engine.totalUnflushedCount,temporaryDirectory:dir,boundary:scenario==='repeat-seal'?'Public audit methods with real filesystem; only MySQL replay is paused. Two rotations re-use one active pathname.':'Real filesystem with a barrier before the first snapshot read opens the path; no bytes forged. Rotation and replacement append complete before the actual snapshot read. MySQL outcomes controlled.'});
  await engine.stopAndFlushAll();
}
{
  const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'mysql-mcp-r7-sealed-control-'));let phase='fallback';const dbIds=[];
  const {AuditEngine:Engine}=load('packages/core-engine/src/audit-engine.ts',{'@mysql-mcp/security':{Masker:{maskSqlText:s=>s}}});
  const engine=new Engine({query:async(_sql,params)=>{if(phase==='fallback')throw new Error('controlled DB fallback');dbIds.push(...params[0].map(row=>row[0]));return [{}]}},{maxUnflushedEvents:100,batchSize:100,flushIntervalMs:10000,emergencyLogDir:dir});
  const submit=async id=>{const slot=await engine.reserveSlotOrBackpressure();await slot.commit({queryInstanceId:id,sqlText:'SELECT 1',isHighRisk:false});await engine.flushBatch()};
  await submit('control-A');const active=path.join(dir,fs.readdirSync(dir)[0]);const sealedA=await engine.sealActiveEmergencyLog(active);
  await submit('control-B');const sealedB=await engine.sealActiveEmergencyLog(active);await submit('control-C');phase='replay';
  const replayedA=await engine.replayEmergencyLogsToDb(sealedA),replayedB=await engine.replayEmergencyLogsToDb(sealedB);
  const activeIds=fs.readFileSync(active,'utf8').trim().split('\n').map(l=>JSON.parse(l).queryInstanceId);
  add('r7_two_seals_then_explicit_sealed_replay_control',replayedA===1&&replayedB===1&&dbIds.includes('control-A')&&dbIds.includes('control-B')&&activeIds.includes('control-C'),{replayedA,replayedB,mysqlDurableIds:dbIds,activeIds,boundary:'No overlapping active-path replay: seal generations independently, then replay immutable paths. Real filesystem, controlled MySQL.'});await engine.stopAndFlushAll();
}
{
  const marker='// packages/core-engine/src/dual-bucket-limiter.ts',start=doc.indexOf(marker);assert(start>=0);
  const original=doc.slice(start,doc.indexOf('\n```',start));
  const fixture=original.replace("import { AppError } from './app-error';","class AppError extends Error {constructor(p:{message?:string;[key:string]:unknown}){super(p.message);Object.assign(this,p)}}").replace("import type { EntityId } from './registry-hub';","type EntityId = string;");
  const typesRoot=path.dirname(path.dirname(require.resolve('@types/node/package.json')));
  const options={strict:true,noEmit:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,moduleResolution:ts.ModuleResolutionKind.Node10,esModuleInterop:true,skipLibCheck:true,types:['node'],typeRoots:[typesRoot]};
  const fixturePath=path.join(path.dirname(path.dirname(require.resolve('typescript/package.json'))),'r7-limiter-fixture.ts');
  const diagnose=source=>{
    const host=ts.createCompilerHost(options),get=host.getSourceFile.bind(host);
    host.getSourceFile=(file,language,...args)=>path.normalize(file)===path.normalize(fixturePath)?ts.createSourceFile(file,source,language,true):get(file,language,...args);
    const program=ts.createProgram([fixturePath],options,host);assert(program.getSourceFiles().some(f=>path.normalize(f.fileName)===path.normalize(fixturePath)));
    return ts.getPreEmitDiagnostics(program).filter(d=>d.file&&path.normalize(d.file.fileName)===path.normalize(fixturePath)).map(d=>({code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,'\n'),documentLine:doc.slice(0,start).split('\n').length+d.file.getLineAndCharacterOfPosition(d.start).line}));
  };
  const diagnostics=diagnose(fixture);
  results.environment.nodeTypes=require('@types/node/package.json').version;
  add('r7_limiter_module_semantic_typecheck',diagnostics.length===0,{diagnostics,boundary:'Entire extracted limiter/loop-breaker block checked by real TS 5.9.3 strict semantics; actual Node crypto typings. Only local AppError and EntityId imports replaced. Not a whole-project build.'});
}

const combine=fs.readFileSync(path.resolve(__dirname,'../../scripts/combine_be_spec.js'),'utf8');
const names=[...combine.matchAll(/"(part[^"\n]+\.md)"/g)].map(m=>m[1]);
assert.equal(names.length,11);
const assembled=names.map(n=>fs.readFileSync(path.resolve(__dirname,'../../scripts/be_parts',n),'utf8').trim()).join('\n\n---\n\n');
results.sourceAssembly={parts:names,byteExactMatch:Buffer.from(assembled).equals(docBytes)};
assert(results.sourceAssembly.byteExactMatch);
results.summary={total:results.tests.length,holds:results.tests.filter(t=>t.invariantHolds).length,violated:results.tests.filter(t=>!t.invariantHolds).length};
const output=process.env.REVIEW_EVIDENCE_FILE||path.join(__dirname,'backend-design-review-round8.evidence.json');
fs.writeFileSync(output,JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
