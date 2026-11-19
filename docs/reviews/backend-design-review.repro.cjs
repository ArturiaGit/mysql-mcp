/**
 * Observational review harness for the fenced TypeScript examples in the design.
 * Executes trusted local document examples with controlled dependency stubs.
 * No production database is contacted. HTTP probes bind only to loopback.
 * Install dependencies into a separate temp prefix; set NODE_PATH to its node_modules.
 * This records observations; exit 0 does NOT mean the design passed security review.
 */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const {Parser} = require('node-sql-parser');
const {EventEmitter} = require('node:events');
const http = require('node:http');
const assert = require('node:assert/strict');
const docPath = process.argv[2] || path.resolve(__dirname, '../BACKEND_ARCHITECTURE_SPEC.md');
const doc = fs.readFileSync(docPath, 'utf8');
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
(async()=>{
const results={environment:{node:process.version,mysql2:require('mysql2/package.json').version,parser:require('node-sql-parser/package.json').version,fastify:require('fastify/package.json').version},tests:[]};
const add=(name,data)=>results.tests.push({name,...data});
const p=new Parser();
const {ScopeExtractor}=load('packages/core-ast/src/scope-extractor.ts');
const {AstValidator}=load('packages/core-ast/src/ast-validator.ts');
for(const sql of [
'SELECT * FROM orders WHERE EXISTS (SELECT 1 FROM secret_salary)',
'SELECT * FROM orders WHERE id IN (SELECT id FROM secret_salary)',
'SELECT * FROM orders o JOIN customers c ON c.id = (SELECT MAX(id) FROM secret_salary)',
'SELECT (SELECT MAX(id) FROM secret_salary) AS n FROM orders',
]){
 const ast=p.astify(sql,{database:'MySQL'});
 const extraction=ScopeExtractor.extractPhysicalTables(ast,'app');
 AstValidator.validateReadOnlyAndSafety(sql,ast,extraction.tables);
 add('scope_extraction',{sql,tables:extraction.tables.map(t=>t.fullName),secretTableFound:extraction.tables.some(t=>t.table==='secret_salary')});
}
const {LimitRewriter}=load('packages/core-ast/src/limit-rewriter.ts');
for(const sql of ['(SELECT * FROM orders LIMIT 1) UNION ALL SELECT * FROM orders','SELECT * FROM orders UNION ALL SELECT * FROM orders LIMIT 1']) {
 try{add('union_limit',{sql,rewritten:LimitRewriter.enforceSafeLimit(p.astify(sql,{database:'MySQL'}),10,20),accepted:true});}
 catch(e){add('union_limit',{sql,accepted:false,error:e.code});}
}
const {SnapshotBuilder}=load('packages/core-engine/src/registry-hub.ts');
const snapshot=SnapshotBuilder.buildSnapshot({requestId:'q_review',user:{id:1,username:'review',status:'ACTIVE',mustChangePassword:false,authVersion:1,roleIds:[1]},pat:{id:1,expiresAt:null,isRevoked:false},roles:[{id:1,roleName:'RESTRICTED',defaultLimit:5,maxLimit:10,maxTimeoutMs:1000,userQpmLimit:2,maxInflightConcurrency:1}],userSpecificQpmLimit:null,profile:{id:1,name:'test',defaultDatabase:'app',capacityQpm:300,maxPoolSize:10,maxInflightConcurrency:30,queueTimeoutMs:3000,status:'ACTIVE'},dbAclRows:[],tableAclRows:[],globalPolicyVersion:1});
add('quota_merge',{input:{defaultLimit:5,maxLimit:10,maxTimeoutMs:1000,userQpmLimit:2,maxInflightConcurrency:1},actual:snapshot.quotas});
let poolOptions;let guardCalls=0;
const mysqlStub={createPool:cfg=>{poolOptions=cfg;return {end:cb=>cb&&cb()};}};
const {ManagedProfilePool}=load('packages/core-engine/src/pool-manager.ts',{'mysql2':mysqlStub});
new ManagedProfilePool(1,{name:'test',host:'blocked.example',port:3306,username:'test',passwordEncrypted:'cipher',defaultDatabase:'app',maxPoolSize:10,queueTimeoutMs:3000,sshConfig:{use_ssh:true}}, {decrypt:()=>'<test-password>'},{resolveAndValidateHost:async()=>{guardCalls++;return '203.0.113.1';}},{});
add('pool_ssrf_ssh',{guardCalls,configuredHost:poolOptions.host,streamConfigured:!!poolOptions.stream,sshRequested:true});
const warnings=[];const oldWarn=console.error;console.error=(...args)=>warnings.push(args.join(' '));
const mysql=require('mysql2');const pool=mysql.createPool({host:'127.0.0.1',maxAllowedPacket:16*1024*1024});console.error=oldWarn;
add('mysql_packet_option',{warnings,actualConfigMaxAllowedPacket:pool.config.connectionConfig.maxAllowedPacket??null});pool.end();
const root=path.dirname(require.resolve('mysql2/package.json'));
const driver=fs.readFileSync(path.join(root,'lib/base/connection.js'),'utf8');
const match=driver.match(/const servername = [\s\S]*?;/);
add('mysql_tls_contract',{servernameSelection:match?.[0],sslServernameRead:/this\.config\.ssl\.servername/.test(driver),verifyIdentityOptIn:driver.includes('const verifyIdentity = this.config.ssl.verifyIdentity;')});
const {executeStreamingQueryWithBudget}=load('packages/core-engine/src/streaming-executor.ts');
const stream=new EventEmitter();const conn={query:()=>({stream:()=>stream})};
const outputPromise=executeStreamingQueryWithBudget(conn,'SELECT 1',[],1000);
stream.emit('data',['汉'.repeat(40000)]);stream.emit('end');const output=await outputPromise;
add('cell_byte_limit',{inputBytes:120000,claimedLimitBytes:65536,outputBytes:Buffer.byteLength(output.rows[0][0],'utf8'),truncated:output.truncated});
const {AuditEngine}=load('packages/core-engine/src/audit-engine.ts',{'node:fs':{promises:{mkdir:async()=>{},appendFile:async()=>{throw new Error('ENOSPC simulated')}}},'@mysql-mcp/security':{Masker:{maskSqlText:s=>s}}});
const engine=new AuditEngine({query:async()=>{throw new Error('DB_DOWN simulated')}},{maxUnflushedEvents:10000,batchSize:200,flushIntervalMs:500,emergencyLogDir:'unused'});
const slot=await engine.reserveSlotOrBackpressure();await slot.commit({queryInstanceId:'q_test',sqlText:'SELECT 1',isHighRisk:false});
let flushError;try{await engine.flushBatch();}catch(e){flushError=e.message;}
add('audit_double_failure',{error:flushError,totalUnflushedAfterFailure:engine.totalUnflushedCount,queueLength:engine.queue.length});
const engine2=new AuditEngine({query:()=>new Promise(()=>{})},{maxUnflushedEvents:10000,batchSize:200,flushIntervalMs:500,emergencyLogDir:'unused'});
const s2=await engine2.reserveSlotOrBackpressure();void s2.commit({queryInstanceId:'q_highrisk',sqlText:'SELECT 1',isHighRisk:true});
add('audit_highrisk_accounting',{databaseWriteStillPending:true,totalUnflushed:engine2.totalUnflushedCount});
let fallbackWrites=0;
const {AuditEngine:AuditEngineFallback}=load('packages/core-engine/src/audit-engine.ts',{'node:fs':{promises:{mkdir:async()=>{},appendFile:async()=>{fallbackWrites++;}}},'@mysql-mcp/security':{Masker:{maskSqlText:s=>s}}});
const engine3=new AuditEngineFallback({query:async()=>{throw new Error('DB_DOWN simulated')}},{maxUnflushedEvents:10000,batchSize:200,flushIntervalMs:500,emergencyLogDir:'unused'});
const s3=await engine3.reserveSlotOrBackpressure();await s3.commit({queryInstanceId:'q_highrisk_fallback',sqlText:'SELECT 1',isHighRisk:true});
add('audit_highrisk_fallback',{databaseAvailable:false,fallbackWrites,highriskCommitResolved:true});
add('bigint_rounding',{ids:['9007199254740992','9007199254740993'],asNumbers:['9007199254740992','9007199254740993'].map(Number),collides:Number('9007199254740992')===Number('9007199254740993')});
const {buildStreamableHttpInvocation}=load('apps/gateway/src/adapters/streamable-http.adapter.ts');
const fastify=require('fastify');
const app=fastify();let signal;let handlerReachedResolve;const handlerReached=new Promise(r=>handlerReachedResolve=r);let doneResolve;const handlerDone=new Promise(r=>doneResolve=r);let closeEvents=0;
app.post('/mcp',async(req,reply)=>{req.raw.on('close',()=>closeEvents++);signal=buildStreamableHttpInvocation(req,reply).abortSignal;handlerReachedResolve();await new Promise(r=>setTimeout(r,120));doneResolve();return {ok:true};});
await app.listen({host:'127.0.0.1',port:0});const port=app.server.address().port;
const client=http.request({host:'127.0.0.1',port,path:'/mcp',method:'POST',headers:{'Content-Type':'application/json'}},res=>res.resume());client.on('error',()=>{});client.end(JSON.stringify({id:1,params:{name:'execute_query',arguments:{sql:'SELECT 1'}}}));await handlerReached;await new Promise(r=>setTimeout(r,15));const abortedBeforeDisconnect=signal.aborted;client.destroy();await new Promise(r=>setTimeout(r,30));
add('http_disconnect',{abortedBeforeDisconnect,abortedAfterDisconnect:signal.aborted,requestCloseEvents:closeEvents});await handlerDone;await app.close();
const app2=fastify();let unblock;let enteredResolve;const entered=new Promise(r=>enteredResolve=r);app2.get('/sse',async()=>{enteredResolve();await new Promise(r=>unblock=r);return 'done';});await app2.listen({host:'127.0.0.1',port:0});const c=http.get(`http://127.0.0.1:${app2.server.address().port}/sse`,res=>res.resume());c.on('error',()=>{});await entered;let closed=false;const closePromise=app2.close().then(()=>closed=true);await new Promise(r=>setTimeout(r,50));add('shutdown_order',{httpCloseResolvedBeforeActiveHandlerReleased:closed,canReachCancellationAfterAwaitClose:closed});unblock();await closePromise;c.destroy();
fs.writeFileSync(path.join(__dirname,'backend-design-review.evidence.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});



