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
const net = require('node:net');
const {PassThrough} = require('node:stream');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results={review:'round-2',reviewedAt:new Date().toISOString(),specSha256:require('node:crypto').createHash('sha256').update(doc).digest('hex'),environment:{node:process.version,mysql2:require('mysql2/package.json').version,parser:require('node-sql-parser/package.json').version,fastify:require('fastify/package.json').version},tests:[]};
const add=(name,expected,data)=>{const invariantHolds=!!expected;results.tests.push({name,invariantHolds,...data});};
const streamModule=load('packages/core-engine/src/streaming-executor.ts');
const {RegistryHub,SnapshotBuilder,normalizeEntityId}=load('packages/core-engine/src/registry-hub.ts');
const {assertSnapshotValidBeforeExecutionSync}=load('apps/gateway/src/pipeline/05-execution-audit.step.ts');
const {ScopeExtractor}=load('packages/core-ast/src/scope-extractor.ts');
const {AstValidator}=load('packages/core-ast/src/ast-validator.ts');
const {LimitRewriter}=load('packages/core-ast/src/limit-rewriter.ts');
const p=new Parser();
const makeSnapshot=()=>SnapshotBuilder.buildSnapshot({requestId:'q_review',user:{id:'1',username:'review',status:'ACTIVE',mustChangePassword:false,authVersion:1,roleIds:['1']},pat:{id:'1',expiresAt:null,isRevoked:false},roles:[{id:'1',roleName:'RESTRICTED',defaultLimit:5,maxLimit:10,maxTimeoutMs:1000,userQpmLimit:2,maxInflightConcurrency:1}],userSpecificQpmLimit:null,profile:{id:'1',name:'test',defaultDatabase:'app',capacityQpm:300,maxPoolSize:10,maxInflightConcurrency:30,queueTimeoutMs:3000,status:'ACTIVE'},dbAclRows:[],tableAclRows:[],globalPolicyVersion:1});
(async()=>{
for(const sql of [
'SELECT * FROM orders WHERE EXISTS (SELECT 1 FROM secret_salary)',
'SELECT * FROM orders WHERE id IN (SELECT id FROM secret_salary)',
'SELECT * FROM orders o JOIN customers c ON c.id=(SELECT MAX(id) FROM secret_salary)',
'SELECT (SELECT MAX(id) FROM secret_salary) AS n FROM orders',
]){const refs=ScopeExtractor.extractPhysicalTables(p.astify(sql,{database:'MySQL'}),'app');const tables=refs.tables.map(t=>t.fullName);add('original_acl_subquery',tables.includes('app.secret_salary'),{sql,tables});}
for(const [sql,shouldAllow] of [
['(SELECT * FROM orders LIMIT 1) UNION ALL SELECT * FROM orders',false],
['SELECT * FROM orders UNION ALL SELECT * FROM orders LIMIT 1',true],
]){let allowed=true,rewritten,error;try{rewritten=LimitRewriter.enforceSafeLimit(p.astify(sql,{database:'MySQL'}),10,20)}catch(e){allowed=false;error=e.code}add('original_union_limit',allowed===shouldAllow,{sql,allowed,rewritten,error});}
const snap=makeSnapshot();add('original_low_role_quota',JSON.stringify(snap.quotas)===JSON.stringify({defaultLimit:5,maxLimit:10,maxTimeoutMs:1000,userQpmLimit:2,maxInflightConcurrency:1}),{quotas:snap.quotas});
for(const input of ['汉'.repeat(40000),'😀'.repeat(20000)]){const r=streamModule.truncateUtf8CellSafe(input);add('original_utf8_cell_limit',Buffer.byteLength(r.value)<=65536&&r.wasTruncated&&!r.value.includes('\uFFFD'),{inputBytes:Buffer.byteLength(input),outputBytes:Buffer.byteLength(r.value),wasTruncated:r.wasTruncated});}
const {buildStreamableHttpInvocation}=load('apps/gateway/src/adapters/streamable-http.adapter.ts');
const fastify=require('fastify');const app=fastify();let signal,cleanup,enteredResolve,doneResolve;const entered=new Promise(r=>enteredResolve=r),done=new Promise(r=>doneResolve=r);
app.post('/mcp',async(req,reply)=>{const inv=buildStreamableHttpInvocation(req,reply);signal=inv.abortSignal;cleanup=inv.cleanupListeners;enteredResolve();await sleep(100);doneResolve();return {ok:true};});await app.listen({host:'127.0.0.1',port:0});const client=http.request({host:'127.0.0.1',port:app.server.address().port,path:'/mcp',method:'POST',headers:{'Content-Type':'application/json'}},res=>res.resume());client.on('error',()=>{});client.end(JSON.stringify({id:1,params:{name:'execute_query',arguments:{sql:'SELECT 1'}}}));await entered;await sleep(15);const before=signal.aborted;client.destroy();await sleep(25);const after=signal.aborted;add('original_http_disconnect',!before&&after,{abortedBeforeDisconnect:before,abortedAfterDisconnect:after});await done;cleanup();await app.close();
const {AuditEngine}=load('packages/core-engine/src/audit-engine.ts',{'node:fs':{promises:{mkdir:async()=>{},appendFile:async()=>{throw new Error('ENOSPC simulated')}}},'@mysql-mcp/security':{Masker:{maskSqlText:s=>s}}});
const cfg={maxUnflushedEvents:10000,batchSize:200,flushIntervalMs:500,emergencyLogDir:'unused'};
const engine=new AuditEngine({query:async()=>{throw new Error('DB_DOWN simulated')}},cfg);let slot=await engine.reserveSlotOrBackpressure();await slot.commit({queryInstanceId:'q_test',sqlText:'SELECT 1',isHighRisk:false});let err;try{await engine.flushBatch()}catch(e){err=e.message}let reserveRejected=false;try{await engine.reserveSlotOrBackpressure()}catch{reserveRejected=true}add('original_audit_double_failure',engine.queue.length===1&&engine.totalUnflushedCount===1&&reserveRejected,{error:err,queueLength:engine.queue.length,totalUnflushed:engine.totalUnflushedCount,reserveRejected});
const engine2=new AuditEngine({query:()=>new Promise(()=>{})},cfg);slot=await engine2.reserveSlotOrBackpressure();void slot.commit({queryInstanceId:'q_hr_pending',sqlText:'SELECT 1',isHighRisk:true});add('original_highrisk_slot',engine2.totalUnflushedCount===1,{totalUnflushed:engine2.totalUnflushedCount});
let fallbackWrites=0;const {AuditEngine:AEFallback}=load('packages/core-engine/src/audit-engine.ts',{'node:fs':{promises:{mkdir:async()=>{},appendFile:async()=>{fallbackWrites++}}},'@mysql-mcp/security':{Masker:{maskSqlText:s=>s}}});const e3=new AEFallback({query:async()=>{throw new Error('DB_DOWN simulated')}},cfg);slot=await e3.reserveSlotOrBackpressure();let hrError;try{await slot.commit({queryInstanceId:'q_hr_failed',sqlText:'SELECT 1',isHighRisk:true})}catch(e){hrError=e.code}add('original_highrisk_strict',hrError==='ERR_AUDIT_STORAGE_UNAVAILABLE',{error:hrError,fallbackWrites});
// Counterexample: reload A read committed ACTIVE v2; a later freeze marks v3 before A publishes v2.
let oldReloadResolve;const hub=new RegistryHub({query:()=>new Promise(r=>oldReloadResolve=r)});hub.userAuthVersions.set('1',{version:1,status:'ACTIVE'});hub.markUserInvalidatedSync('1');const oldReload=hub.reloadUserAuthFromDb('1');hub.markUserInvalidatedSync('1');const beforeReload=hub.isUserInvalidated('1');oldReloadResolve([[{status:'ACTIVE',auth_version:2}]]);await oldReload;const previousCommittedSnapshot={...makeSnapshot(),authVersion:2};let oldSnapshotAllowed=true;try{assertSnapshotValidBeforeExecutionSync(previousCommittedSnapshot,hub,new AbortController().signal)}catch{oldSnapshotAllowed=false}add('new_stale_reload_clears_new_tombstone',hub.isUserInvalidated('1')&&!oldSnapshotAllowed,{invalidatedBeforeOldReload:beforeReload,invalidatedAfterOldReload:hub.isUserInvalidated('1'),currentVersion:hub.getUserAuthVersion('1'),oldSnapshotAllowed});
// Exact new bridge transport, with only mysql2 pool construction replaced; real loopback TCP.
const peers=[];const serverReceived=[];const server=net.createServer(sock=>{peers.push(sock);sock.on('error',()=>{});sock.on('data',b=>serverReceived.push(b.toString()));sock.write('SERVER_GREETING');});await new Promise(r=>server.listen(0,'127.0.0.1',r));let poolOptions;let guardCalls=0;const {ManagedProfilePool}=load('packages/core-engine/src/pool-manager.ts',{'mysql2':{createPool:opts=>{poolOptions=opts;return {getConnection(){},end:cb=>cb()}}}});new ManagedProfilePool('1',{name:'test',host:'db.example',port:server.address().port,username:'u',passwordEncrypted:'encrypted',defaultDatabase:'app',maxPoolSize:1,queueTimeoutMs:1000},{decrypt:()=>'<test-password>'},{resolveAndValidateHost:async()=>{guardCalls++;return '127.0.0.1'}});const bridge=poolOptions.stream();const driverReceived=[];bridge.on('data',b=>driverReceived.push(b.toString()));bridge.on('error',()=>{});await sleep(40);bridge.write('CLIENT_COMMAND');await sleep(40);add('new_transport_directionality',!serverReceived.join('').includes('SERVER_GREETING')&&!driverReceived.join('').includes('CLIENT_COMMAND'),{serverReceived:serverReceived.join(''),driverReceived:driverReceived.join('')});add('original_pool_ssrf_wiring',guardCalls>=2&&typeof poolOptions.stream==='function'&&!('maxAllowedPacket' in poolOptions),{guardCalls,configuredHost:poolOptions.host,streamConfigured:typeof poolOptions.stream==='function',maxAllowedPacketPresent:'maxAllowedPacket' in poolOptions});bridge.destroy();for(const peer of peers)peer.destroy();await new Promise(r=>server.close(r));
// ssl configuration preserves hostname, but driver TLS upgrade replaces the stream object.
const mysqlRoot=path.dirname(require.resolve('mysql2/package.json'));const BaseConnection=require(path.join(mysqlRoot,'lib/base/connection.js'));const tls=require('node:tls');const oldConnect=tls.connect;const transport=new PassThrough();transport.__verified_endpoint={logicalHost:'db.example',pinnedIp:'203.0.113.5',port:3306,useSsh:false};transport.__resetWireByteCounter=()=>{};const tlsStream=new PassThrough();const fakeConn={config:{host:'db.example',port:3306,ssl:{rejectUnauthorized:true,verifyIdentity:true}},stream:transport,packetParser:{execute(){}},_handleNetworkError(){}};try{tls.connect=()=>tlsStream;BaseConnection.prototype.startTLS.call(fakeConn,()=>{});}finally{tls.connect=oldConnect;}add('new_tls_transport_metadata',!!fakeConn.stream.__verified_endpoint&&typeof fakeConn.stream.__resetWireByteCounter==='function',{streamWasReplaced:fakeConn.stream!==transport,endpointOnTransport:!!transport.__verified_endpoint,endpointOnCurrentStream:!!fakeConn.stream.__verified_endpoint,resetOnCurrentStream:typeof fakeConn.stream.__resetWireByteCounter==='function'});transport.destroy();tlsStream.destroy();
// stopAndFlushAll must await an already running flusher, not just return from its re-entry guard.
let dbResolve;const stopEngine=new AuditEngine({query:()=>new Promise(r=>dbResolve=r)},cfg);slot=await stopEngine.reserveSlotOrBackpressure();await slot.commit({queryInstanceId:'q_shutdown',sqlText:'SELECT 1',isHighRisk:false});const background=stopEngine.flushBatch();let stopped=false;const stopPromise=stopEngine.stopAndFlushAll().then(()=>stopped=true);await sleep(25);add('new_audit_shutdown_wait',!stopped||stopEngine.totalUnflushedCount===0,{stopReturned:stopped,totalUnflushedAtObservation:stopEngine.totalUnflushedCount,isFlushing:stopEngine.isFlushing});dbResolve([{}]);await Promise.all([background,stopPromise]);
// Runtime duplicate normalizer must reject already imprecise number inputs just like toEntityId.
const unsafe=Number('9007199254740993');let accepted;try{accepted=normalizeEntityId(unsafe)}catch{}add('new_runtime_entityid_normalizer',accepted===undefined,{unsafeNumber:unsafe,normalizerAccepted:accepted});
// Leading-zero string aliases pass validation but skip string-identity security guards.
const {toEntityId}=load('packages/shared-types/src/entities.ts');
for(const [target,operator] of [['1','1'],['01','1'],['01','2']]){
  const seen={sql:[],tombstones:[],cancelledUsers:[],reloads:[]};
  const conn={query:async(sql,params)=>{seen.sql.push({sql,params});return sql.includes('SELECT u.id')?[[{id:'1'}]]:[{affectedRows:1}]}};
  const {UserService}=load('apps/admin-api/src/services/user.service.ts',{'@mysql-mcp/shared-types':{toEntityId},'../repositories/base.repository':{withTransaction:async(_pool,work)=>work(conn)}});
  const svc=new UserService({}, {markUserInvalidatedSync:id=>seen.tombstones.push(id),reloadUserAuthFromDb:async id=>seen.reloads.push(id)}, {cancelQueriesByUser:id=>seen.cancelledUsers.push(id)});
  let error;try{await svc.updateUserStatus(target,'DISABLED',operator)}catch(e){error=e.code||e.message}
  const update=seen.sql.find(q=>q.sql.includes('UPDATE sys_users'));
  add(target==='1'?'original_canonical_self_operation_guard':'new_leading_zero_entityid_guard',target==='1'?error==='ERR_SELF_OPERATION_FORBIDDEN':!!error,{target,operator,normalizedTarget:toEntityId(target),error:error??null,updateIssued:!!update,updateId:update?.params[1],tombstones:seen.tombstones,cancelledUsers:seen.cancelledUsers,modelBoundary:'SQL is recorded by a stub; no real MySQL UPDATE was executed.'});
}
// Exact SSH implementation, controlled client: no real SSH connection is opened.
const sshObserved={guardHosts:[],forwardTarget:null,hostVerifierConfigured:false};class FakeSsh extends EventEmitter{connect(opts){sshObserved.hostVerifierConfigured=typeof opts.hostVerifier==='function';sshObserved.pinnedBastion=opts.host;queueMicrotask(()=>this.emit('ready'));return this}forwardOut(_s,_p,host,port,cb){sshObserved.forwardTarget={host,port};cb(null,new PassThrough())}end(){}}
const {SshTunnelManager}=load('packages/core-engine/src/ssh-tunnel.ts',{'ssh2':{Client:FakeSsh}});const ssh=new SshTunnelManager({decrypt:()=>'<test-private-key>'},{resolveAndValidateHost:async host=>{sshObserved.guardHosts.push(host);return '203.0.113.8'}});const ch=await ssh.openTunnelStream('1',{use_ssh:true,host:'bastion.example',username:'u',private_key_encrypted:'cipher'},'169.254.169.254',80);add('new_ssh_forward_target_guard',sshObserved.guardHosts.includes('169.254.169.254'),sshObserved);add('new_ssh_hostkey_required',sshObserved.hostVerifierConfigured,{hostVerifierConfigured:sshObserved.hostVerifierConfigured,openedWithoutHostFingerprint:true});ch.destroy();await ssh.closeAllTunnels();
// Returned rows still occupy memory even after the end handler has zeroed accounting.
const tracker=new streamModule.UserMemoryBudgetTracker();const es=new EventEmitter();const qconn={query:()=>({stream:()=>es})};const pending=streamModule.executeStreamingQueryWithBudget(qconn,'SELECT 1',[],1000,{userId:'1',tracker});es.emit('data',['retained payload']);const countedBefore=tracker.userBytes.get('1');es.emit('end');const retained=await pending;add('new_result_memory_ownership',tracker.userBytes.get('1')>0,{countedBeforeEnd:countedBefore,countedAfterEnd:tracker.userBytes.get('1')??0,retainedRows:retained.rows.length});
// Node net's custom lookup receives {all:true} under default auto family selection.
const {NotificationService}=load('apps/admin-api/src/services/notification.service.ts');let lookupAll;const notifyService=new NotificationService({resolveAndValidateHost:async()=> '127.0.0.1'});let notifyError;const nativeNetCreate=net.createConnection;try{await notifyService.sendWebhookMessage('DINGTALK','https://review-probe.invalid:9/hook','Review','Local-only probe')}catch(e){notifyError={code:e.code,message:e.message}}add('new_webhook_lookup_contract',notifyError?.code!=='ERR_INVALID_IP_ADDRESS',{error:notifyError});
// Explicit schema must take precedence over the special unqualified dummy DUAL.
const dualSql='SELECT * FROM app.`dual`';const dualRef=ScopeExtractor.extractPhysicalTables(p.astify(dualSql,{database:'MySQL'}),'app');add('new_qualified_dual_extraction',dualRef.tables.some(t=>t.fullName==='app.dual'),{sql:dualSql,tables:dualRef.tables,isKnownNoTableQuery:dualRef.isKnownNoTableQuery});
results.summary={total:results.tests.length,holds:results.tests.filter(t=>t.invariantHolds).length,violated:results.tests.filter(t=>!t.invariantHolds).length};const output=process.env.REVIEW_EVIDENCE_FILE||path.join(__dirname,'backend-design-review-round2.evidence.json');fs.writeFileSync(output,JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
