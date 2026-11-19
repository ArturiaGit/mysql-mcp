/**
 * Observational review harness for the fenced TypeScript examples in the design.
 * Executes trusted local document examples with controlled dependency stubs.
 * No production database is contacted. HTTP, TCP, and real TLS probes bind only to loopback.
 * SSH, query execution, management SQL, and server startup use controlled dependency stubs.
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
const docPath = path.resolve(process.argv[2] || path.resolve(__dirname, '../BACKEND_ARCHITECTURE_SPEC.md'));
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
const results={review:'round-4',reviewedAt:new Date().toISOString(),specSha256:require('node:crypto').createHash('sha256').update(doc).digest('hex'),environment:{node:process.version,mysql2:require('mysql2/package.json').version,parser:require('node-sql-parser/package.json').version,fastify:require('fastify/package.json').version},tests:[]};
const add=(name,expected,data)=>{const invariantHolds=!!expected;results.tests.push({name,invariantHolds,...structuredClone(data)});};
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
// Preserve the 27 round-2 observations, then exercise new boundary cases.
results.baseline={total:results.tests.length,holds:results.tests.filter(t=>t.invariantHolds).length,violated:results.tests.filter(t=>!t.invariantHolds).length};
results.environment.typescript=require('typescript/package.json').version;
results.environment.nodeForge=require('node-forge/package.json').version;
results.environment.ipaddr=require('ipaddr.js/package.json').version;
// A lease can be explicitly released exactly once after its consumer finishes.
retained.releaseMemoryLease();retained.releaseMemoryLease();
add('r3_result_memory_lease_idempotent_release',(tracker.userBytes.get('1')??0)===0,{countedAfterRelease:tracker.userBytes.get('1')??0});
{
  const {SsrfGuard}=load('packages/security/src/ssrf-guard.ts');
  const guard=new SsrfGuard('');let error;
  const {SshTunnelManager}=load('packages/core-engine/src/ssh-tunnel.ts',{'ssh2':{Client:class{constructor(){throw new Error('Unexpected SSH connection attempt')}}}});
  try{await new SshTunnelManager({decrypt:()=>''},guard).openTunnelStream('1',{use_ssh:true},'169.254.169.254',80)}catch(e){error=e.code||e.message}
  add('r3_ssh_prohibited_forward_target_actually_rejected',error==='ERR_SSRF_PROHIBITED',{error});
}

{
  const sql='SELECT * FROM `dual`';
  const ast=p.astify(sql,{database:'MySQL'});
  const extracted=ScopeExtractor.extractPhysicalTables(ast,'app',0);
  let denied=false;try{AstValidator.validateReadOnlyAndSafety(sql,ast,extracted.tables)}catch{denied=true}
  const rewritten=LimitRewriter.enforceSafeLimit(ast,10,20);
  add('r3_quoted_unqualified_dual',extracted.tables.some(t=>t.fullName==='app.dual'),{sql,astFrom:ast.from,extracted,safetyDenied:denied,rewritten});
  const bareAst=p.astify('SELECT 1 FROM DUAL',{database:'MySQL'});const bare=ScopeExtractor.extractPhysicalTables(bareAst,'app',0);add('r3_bare_dual_known_no_table',bare.isKnownNoTableQuery,{sql:'SELECT 1 FROM DUAL',astFrom:bareAst.from,extracted:bare});
}
{
  const poolModule=load('packages/core-engine/src/pool-manager.ts',{'mysql2':{createPool:opts=>{return {getConnection(){},end:cb=>cb()}}}});
  let capturedRuntime;const listened=[];
  const activeCfg={id:'1',name:'active',host:'db.example',port:3306,username:'u',passwordEncrypted:'cipher',defaultDatabase:'app',maxPoolSize:1,queueTimeoutMs:1000};
  const metadataQueries=[];const metadata={query:async(sql)=>{metadataQueries.push(sql);return [sql.includes('sys_profiles')?[{...activeCfg,status:'ACTIVE',version:1}]:[{id:'1',status:'ACTIVE',auth_version:1}]]},end:async()=>{}};
  class EmptyComponent{};
  const fakeServer=name=>({listen:async()=>{listened.push(name)},close:async()=>{}});
  const config={GATEWAY_MASTER_KEYS:'{}',ALLOWED_OUTBOUND_IPS:'',DB_HOST:'metadata',PORT_GATEWAY:8080,PORT_ADMIN:8081};
  const beforeSignals={SIGINT:process.listeners('SIGINT'),SIGTERM:process.listeners('SIGTERM')};
  const boot=load('apps/gateway/src/bootstrap-host.ts',{
    '@mysql-mcp/core-engine':{createMetadataPool:()=>metadata,RegistryHub,SshTunnelManager:EmptyComponent,AdminMaintenanceChannel:EmptyComponent,PoolManager:poolModule.PoolManager,QueryLifecycleCoordinator:EmptyComponent,AuditEngine:class{startBackgroundFlusher(){}},MetricsCollector:EmptyComponent},
    '@mysql-mcp/security':{CryptoKeyring:{fromEnvJson:()=>({decrypt:()=>'<test-password>'})},SsrfGuard:class{async resolveAndValidateHost(){return '203.0.113.10'}}},
    './server':{buildGatewayServer:async ctx=>{capturedRuntime=ctx;return fakeServer('gateway')}},
    '@mysql-mcp/admin-api':{BootstrapService:class{async ensureSystemInitialized(){}},buildAdminServer:async()=>fakeServer('admin')},
    './config/env':{loadEnvConfig:()=>config},
  });
  try{await boot.startSingleProcessHost();}finally{for(const sig of ['SIGINT','SIGTERM'])for(const listener of process.listeners(sig))if(!beforeSignals[sig].includes(listener))process.removeListener(sig,listener);}
  const bootPoolCount=capturedRuntime.poolManager.pools.size;
  const control=new poolModule.PoolManager({}, {decrypt:()=>'<test-password>'},{resolveAndValidateHost:async()=> '203.0.113.10'},{});
  await control.warmUpActiveProfiles([activeCfg]);
  add('r3_bootstrap_active_profiles_wiring',bootPoolCount===1,{configuredActiveProfiles:1,registryProfileCount:capturedRuntime.registryHub.profileStates.size,bootPoolCount,controlWithExplicitConfigs:control.pools.size,listened,metadataQueries});
  await control.closeAllPools();
}
{
  const ownCfg={maxUnflushedEvents:10,batchSize:10,flushIntervalMs:1000,emergencyLogDir:'<stubbed>'};
  let writeResolve;const engine=new AuditEngine({query:()=>new Promise(r=>writeResolve=r)},ownCfg);
  const slot=await engine.reserveSlotOrBackpressure();
  const write=slot.commit({queryInstanceId:'r3_hr_shutdown',sqlText:'SELECT 1',isHighRisk:true});
  let stopReturned=false;const stop=engine.stopAndFlushAll().then(()=>stopReturned=true);
  await sleep(20);
  add('r3_shutdown_pending_highrisk_write',!stopReturned,{stopReturned,totalUnflushed:engine.totalUnflushedCount,activeFlushPromisePresent:engine.activeFlushPromise!==null});
  writeResolve([{}]);await Promise.all([stop,write]);
  const engine2=new AuditEngine({query:async()=>[{}]},ownCfg);
  const preReserved=await engine2.reserveSlotOrBackpressure();
  let returned2=false;const stop2=engine2.stopAndFlushAll().then(()=>returned2=true);
  await sleep(10);
  add('r3_shutdown_preexisting_reservation',!returned2,{stopReturned:returned2,totalUnflushed:engine2.totalUnflushedCount});
  await preReserved.commit({queryInstanceId:'r3_late_commit',sqlText:'SELECT 1',isHighRisk:false});await engine2.flushBatch();await stop2;
}
{
  const observations={connects:[],forwards:[],verifierResults:[]};let nextId=0;
  const hashA='a'.repeat(64),hashB='b'.repeat(64);
  class FakeVerifiedSsh extends EventEmitter{
    constructor(){super();this.clientId=++nextId;}
    connect(opts){const hash=opts.host==='203.0.113.1'?hashA:hashB;const accepted=typeof opts.hostVerifier==='function'&&opts.hostVerifier(hash);observations.connects.push({clientId:this.clientId,host:opts.host});observations.verifierResults.push(accepted);queueMicrotask(()=>this.emit(accepted?'ready':'error',accepted?undefined:new Error('HOSTKEY_REJECTED')));return this;}
    forwardOut(_src,_port,host,port,cb){observations.forwards.push({clientId:this.clientId,host,port});cb(null,new PassThrough());}
    end(){this.emit('close');}
  }
  const {SshTunnelManager}=load('packages/core-engine/src/ssh-tunnel.ts',{'ssh2':{Client:FakeVerifiedSsh}});
  const keyring={decrypt:()=>'<test-private-key>'};const guards={resolveAndValidateHost:async h=>h==='bastion-a.example'?'203.0.113.1':h==='bastion-b.example'?'203.0.113.2':'198.51.100.7'};
  const configA={use_ssh:true,host:'bastion-a.example',username:'u',private_key_encrypted:'cipher-a',host_fingerprint_sha256:hashA};
  const configB={...configA,host:'bastion-b.example',private_key_encrypted:'cipher-b',host_fingerprint_sha256:hashB};
  const manager=new SshTunnelManager(keyring,guards);
  const a=await manager.openTunnelStreamWithMeta('1',configA,'db.example',3306);
  const b=await manager.openTunnelStreamWithMeta('1',configB,'db.example',3306);
  add('r3_ssh_config_generation_trust',observations.connects.length===2,{...observations,requestedSecondBastion:configB.host,secondUsedClientId:observations.forwards[1].clientId});
  a.stream.destroy();b.stream.destroy();await manager.closeAllTunnels();
  const fresh=new SshTunnelManager(keyring,guards);const before=observations.forwards.length;let error;
  try{await fresh.openTunnelStream('2',{...configA,host_fingerprint_sha256:undefined},'db.example',3306)}catch(e){error=e.message}
  add('r3_missing_ssh_fingerprint_actually_rejected',!!error&&observations.forwards.length===before,{error,forwardAttempted:observations.forwards.length!==before,verifierResult:observations.verifierResults.at(-1)});
  await fresh.closeAllTunnels();
}
{
  const {PinnedDuplexTransport}=load('packages/core-engine/src/pool-manager.ts');
  for(const provideEndpoint of [true,false]){
    const seen={tcp:[],guardCalls:[],sql:[]};let capturedTransport;
    const fakeNet={connect:opts=>{seen.tcp.push(opts);const stream=new PassThrough();stream.setNoDelay=()=>{};return stream;}};
    const fakeMysql={createConnection:opts=>{capturedTransport=opts.stream();return {connect:cb=>queueMicrotask(()=>cb(null)),query:(sql,cb)=>{seen.sql.push(sql);cb(null)},destroy:()=>capturedTransport.destroy()}}};
    const {AdminMaintenanceChannel}=load('packages/core-engine/src/admin-channel.ts',{'mysql2':fakeMysql,'node:net':fakeNet,'./pool-manager':{PinnedDuplexTransport}});
    const channel=new AdminMaintenanceChannel({decrypt:()=>'<test-password>'},{resolveAndValidateHost:async h=>{seen.guardCalls.push(h);return '203.0.113.99'}});
    const endpoint={logicalHost:'original.example',pinnedIp:'203.0.113.11',port:3306,useSsh:false};
    let error;try{await channel.killQuery({profileId:'1',host:'changed.example',port:3307,username:'u',passwordEncrypted:'cipher',verifiedEndpoint:provideEndpoint?endpoint:undefined},123)}catch(e){error=e.message}
    add(provideEndpoint?'r3_kill_uses_original_endpoint_port':'r3_kill_requires_verified_lease',provideEndpoint?seen.tcp[0]?.port===endpoint.port:!!error&&seen.tcp.length===0,{provideEndpoint,originalEndpoint:endpoint,mutableConfigPort:3307,...seen,error:error??null});
  }
}
{
  let capturedPoolOptions;
  const {ManagedProfilePool}=load('packages/core-engine/src/pool-manager.ts',{'mysql2':{createPool:opts=>{capturedPoolOptions=opts;return {getConnection(){},end:cb=>cb()}}}});
  new ManagedProfilePool('1',{name:'tls',host:'db.example',port:3306,username:'u',passwordEncrypted:'cipher',defaultDatabase:'app',maxPoolSize:1,queueTimeoutMs:1000,tlsConfig:{rejectUnauthorized:false}},{decrypt:()=>'<test-password>'},{resolveAndValidateHost:async()=> '127.0.0.1'});
  // Real loopback TLS exchange, not a MySQL protocol session. Certificate/key exist only in memory.
  const forge=require('node-forge');const tls=require('node:tls');
  const keys=forge.pki.rsa.generateKeyPair(2048);const cert=forge.pki.createCertificate();cert.publicKey=keys.publicKey;cert.serialNumber='01';cert.validity.notBefore=new Date(Date.now()-60000);cert.validity.notAfter=new Date(Date.now()+86400000);const dn=[{name:'commonName',value:'wrong.example'}];cert.setSubject(dn);cert.setIssuer(dn);cert.setExtensions([{name:'subjectAltName',altNames:[{type:2,value:'wrong.example'}]}]);cert.sign(keys.privateKey,forge.md.sha256.create());
  const peers=new Set();const server=tls.createServer({key:forge.pki.privateKeyToPem(keys.privateKey),cert:forge.pki.certificateToPem(cert)},socket=>{peers.add(socket);socket.on('error',()=>{})});server.on('tlsClientError',()=>{});server.on('connection',socket=>{peers.add(socket);socket.on('error',()=>{})});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const BaseConnection=require(path.join(path.dirname(require.resolve('mysql2/package.json')),'lib/base/connection.js'));
  async function tryDriverTls(ssl,host='db.example'){const raw=net.connect({host:'127.0.0.1',port:server.address().port});raw.on('error',()=>{});await new Promise((r,j)=>raw.once('connect',r).once('error',j));const fake={config:{host,port:server.address().port,ssl},stream:raw,packetParser:{execute(){}},_handleNetworkError(){}};let deadline;const result=await new Promise(resolve=>{deadline=setTimeout(()=>resolve({accepted:false,code:'PROBE_DEADLINE'}),2500);BaseConnection.prototype.startTLS.call(fake,err=>resolve({accepted:!err,error:err?.code||err?.message,authorized:fake.stream.authorized,authorizationError:fake.stream.authorizationError}));});clearTimeout(deadline);fake.stream.destroy();raw.destroy();return result;}
  const insecure=await tryDriverTls(capturedPoolOptions.ssl);const secure=await tryDriverTls({...capturedPoolOptions.ssl,rejectUnauthorized:true});
  const trustedCa=forge.pki.certificateToPem(cert);
  const wrongHost=await tryDriverTls({...capturedPoolOptions.ssl,ca:trustedCa});
  const wrongHostStrict=await tryDriverTls({...capturedPoolOptions.ssl,ca:trustedCa,rejectUnauthorized:true});
  const valid=await tryDriverTls({...capturedPoolOptions.ssl,ca:trustedCa,rejectUnauthorized:true},'wrong.example');
  add('r3_tls_strict_control_accepts_matching_trusted_certificate',valid.accepted&&valid.authorized,{requestedHost:'wrong.example',driverResult:valid});
  add('r3_tls_wrong_hostname_cannot_be_ignored',!wrongHost.accepted,{trustedCa:true,verifyIdentity:true,rejectUnauthorized:false,driverResult:wrongHost});
  add('r3_tls_strict_control_rejects_wrong_hostname',!wrongHostStrict.accepted,{driverResult:wrongHostStrict});
  add('r3_tls_cannot_disable_certificate_verification',capturedPoolOptions.ssl.rejectUnauthorized===true&&!insecure.accepted,{configuredSsl:capturedPoolOptions.ssl,certificate:'self-signed; SAN wrong.example; requested host db.example',insecureDriverResult:insecure});
  add('r3_tls_strict_control_rejects_untrusted_certificate',!secure.accepted,{secureDriverResult:secure});
  for(const peer of peers)peer.destroy();await new Promise(r=>server.close(r));
}
{
  let dbVersion=3;const hub=new RegistryHub({query:async()=>[[{status:'ACTIVE',auth_version:dbVersion}]]});
  hub.userAuthVersions.set('1',{version:1,status:'ACTIVE'});
  hub.markUserInvalidatedSync('1'); // Notification A for committed DB v2.
  await hub.reloadUserAuthFromDb('1'); // SELECT sees B's already committed DB v3 before notification B.
  const publishedAfterA=hub.getUserAuthVersion('1');
  hub.markUserInvalidatedSync('1'); // Delayed COMMIT completion/notification B for DB v3.
  await hub.reloadUserAuthFromDb('1');
  add('r3_auth_min_version_overshoots_committed_db',!hub.isUserInvalidated('1')&&hub.getUserAuthVersion('1')===3,{committedDbVersion:dbVersion,publishedAfterA,registryVersion:hub.getUserAuthVersion('1'),invalidatedAfterBothReloads:hub.isUserInvalidated('1'),boundary:'Controlled transaction notification/read ordering; no real DB concurrency executed.'});
}
{
  // Dependency import succeeds from its own module location; process.cwd() deliberately has no node_modules.
  const cp=require('node:child_process');const os=require('node:os');const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'mysql-mcp-r3-cwd-'));const childPath=path.join(scratch,'cwd-probe.cjs');
  const child=`const {createRequire}=require('node:module');const depRequire=createRequire(${JSON.stringify(require.resolve('typescript/package.json'))});const fs=require('node:fs');const path=require('node:path');const ts=depRequire('typescript');const doc=fs.readFileSync(${JSON.stringify(docPath)},'utf8');const marker='// packages/core-engine/src/pool-manager.ts';const start=doc.indexOf(marker);const src=doc.slice(start,doc.indexOf('\\n'+'\x60\x60\x60',start));const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;const m={exports:{}};class AppError extends Error{};new Function('require','module','exports',js)(id=>id==='./app-error'?{AppError}:depRequire(id),m,m.exports);const Base=depRequire(path.join(path.dirname(depRequire.resolve('mysql2/package.json')),'lib/base/connection.js'));const {PassThrough}=require('node:stream');const tls=require('node:tls');const original=tls.connect;const raw=new PassThrough();raw.__verified_endpoint={logicalHost:'db.example',pinnedIp:'203.0.113.1',port:3306,useSsh:false};raw.__resetWireByteCounter=()=>{};const fake={config:{host:'db.example',port:3306,ssl:{rejectUnauthorized:true,verifyIdentity:true}},stream:raw,packetParser:{execute(){}},_handleNetworkError(){}};const upgraded=new PassThrough();try{tls.connect=()=>upgraded;Base.prototype.startTLS.call(fake,()=>{});}finally{tls.connect=original;}console.log(JSON.stringify({dependencyImportSucceeded:true,patchInstalled:!!Base.prototype.startTLS.__mcp_meta_patched,endpointPreserved:!!fake.stream.__verified_endpoint,resetPreserved:typeof fake.stream.__resetWireByteCounter==='function'}));raw.destroy();upgraded.destroy();`;
  fs.writeFileSync(childPath,child);const env={...process.env};delete env.NODE_PATH;const proc=cp.spawnSync(process.execPath,[childPath],{cwd:scratch,env,encoding:'utf8',timeout:10000});
  let data;try{data=JSON.parse(proc.stdout.trim())}catch{data={stdout:proc.stdout,stderr:proc.stderr}}
  add('r3_tls_metadata_independent_of_cwd',proc.status===0&&data.endpointPreserved&&data.resetPreserved,{childStatus:proc.status,...data,stderr:proc.stderr||undefined});
}

// ---- Round 4: new boundary probes. All DB/SSH operations remain controlled stubs. ----
const generatorPath=path.resolve(path.dirname(docPath),'../scripts/combine_be_spec.js');
const partNames=[...fs.readFileSync(generatorPath,'utf8').matchAll(/"(part\d+[^"\n]*\.md)"/g)].map(m=>m[1]);
const assembled=partNames.map(p=>fs.readFileSync(path.join(path.dirname(generatorPath),'be_parts',p),'utf8').trim()).join('\n\n---\n\n');
results.sourceAssembly={parts:partNames,byteExactMatch:Buffer.from(assembled).equals(fs.readFileSync(docPath))};
assert(results.sourceAssembly.byteExactMatch,'source fragments and reviewed body differ');
results.previousRounds={total:results.tests.length,holds:results.tests.filter(t=>t.invariantHolds).length,violated:results.tests.filter(t=>!t.invariantHolds).length};
for (const [name,sql,expected] of [
  ['r4_quoted_identifier_identity','SELECT * FROM ` orders`',['app. orders']],
  ['r4_cte_name_must_not_shadow_different_physical_identifier','WITH salary AS (SELECT 1) SELECT * FROM orders JOIN ` salary` ON 1=1',['app.orders','app. salary']],
  ['r4_exact_cte_alias_control','WITH salary AS (SELECT 1) SELECT * FROM orders JOIN salary ON 1=1',['app.orders']],
]) {
  const ast=p.astify(sql,{database:'MySQL'});
  const refs=ScopeExtractor.extractPhysicalTables(ast,'app',0);
  let validationError=null;try{AstValidator.validateReadOnlyAndSafety(sql,ast,refs.tables)}catch(e){validationError=e.code||e.message}
  const rewritten=LimitRewriter.enforceSafeLimit(ast,5,10);
  const actual=refs.tables.map(t=>t.fullName);
  add(name,actual.length===expected.length&&expected.every(t=>actual.includes(t)),{sql,parserFrom:ast.from,expectedPhysicalReferences:expected,extractedPhysicalReferences:actual,validationError,rewritten,boundary:'Actual locked parser/extractor/validator/rewriter. No MySQL query or production ACL evaluator executed.'});
}
{
  let bastionLookups=0,clientCount=0;const calls=[];
  class Fake extends EventEmitter {
    connect(opts){clientCount++;calls.push({host:opts.host});queueMicrotask(()=>this.emit('ready'));return this}
    forwardOut(_src,_port,host,port,cb){cb(null,new PassThrough())}
    end(){}
  }
  const {SshTunnelManager:Manager}=load('packages/core-engine/src/ssh-tunnel.ts',{'ssh2':{Client:Fake}});
  const manager=new Manager({decrypt:()=>'<test-key>'},{resolveAndValidateHost:async host=>{
    if(host==='bastion.example'&&++bastionLookups===1) throw Object.assign(new Error('simulated transient DNS EAI_AGAIN'),{code:'EAI_AGAIN'});
    return '203.0.113.8';
  }});
  const config={use_ssh:true,host:'bastion.example',username:'u',private_key_encrypted:'cipher',host_fingerprint_sha256:'fp'};
  const errors=[];let recovered=false;
  for(let i=0;i<2;i++)try{const channel=await manager.openTunnelStream('1',config,'db.example',3306);channel.destroy();recovered=true;errors.push(null)}catch(e){errors.push(e.code||e.message)}
  add('r4_ssh_transient_preconnect_failure_can_retry',recovered&&bastionLookups===2,{bastionLookups,clientCount,errors,recovered,cachedClientEntries:manager.activeClients.size,boundary:'Exact manager with controlled DNS and ssh2 client; no actual SSH.'});
  await manager.closeAllTunnels();
  const control=new Manager({decrypt:()=>'<test-key>'},{resolveAndValidateHost:async()=> '203.0.113.8'});
  const ch=await control.openTunnelStream('1',config,'db.example',3306);ch.destroy();
  add('r4_ssh_ready_control',clientCount===1,{clientCount,calls});await control.closeAllTunnels();
}
{
  const sourceFor=marker=>{const start=doc.indexOf('// '+marker);assert(start>=0);return doc.slice(start,doc.indexOf('\n```',start))};
  const registryAst=ts.createSourceFile('registry-hub.ts',sourceFor('packages/core-engine/src/registry-hub.ts'),ts.ScriptTarget.Latest,true);
  const poolAst=ts.createSourceFile('pool-manager.ts',sourceFor('packages/core-engine/src/pool-manager.ts'),ts.ScriptTarget.Latest,true);
  const getMethod=(ast,cls,method)=>ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text===cls).members.find(n=>n.name?.getText(ast)===method);
  const getConfig=getMethod(registryAst,'RegistryHub','getActiveProfileConfigs');
  const warmUp=getMethod(poolAst,'PoolManager','warmUpActiveProfiles');
  const returnType=getConfig.type.getText(registryAst),parameterType=warmUp.parameters[0].type.getText(poolAst);
  const exactCall='await poolManager.warmUpActiveProfiles(registryHub.getActiveProfileConfigs());';
  assert(doc.includes(exactCall));
  const fixture='interface SshProfileConfig { use_ssh:boolean }\ndeclare const registryHub:{getActiveProfileConfigs(): '+returnType+'};\ndeclare const poolManager:{warmUpActiveProfiles(activeProfileConfigs?: '+parameterType+'):Promise<void>};\nasync function bootstrap(){'+exactCall+'}\n';
  const options={strict:true,noEmit:true,target:ts.ScriptTarget.ES2022,types:[],skipLibCheck:true};
  const fixturePath=path.join(require('node:os').tmpdir(),'mysql-mcp-r4-signature.ts');
  const host=ts.createCompilerHost(options);const originalGetSourceFile=host.getSourceFile.bind(host);
  host.getSourceFile=(file,lang,...args)=>path.normalize(file)===path.normalize(fixturePath)?ts.createSourceFile(file,fixture,lang,true):originalGetSourceFile(file,lang,...args);
  const program=ts.createProgram([fixturePath],options,host);
  assert(program.getSourceFiles().some(f=>path.normalize(f.fileName)===path.normalize(fixturePath)),'signature fixture must be loaded');
  const diagnostics=ts.getPreEmitDiagnostics(program).filter(d=>d.file&&path.normalize(d.file.fileName)===path.normalize(fixturePath)).map(d=>({code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,'\n')}));
  add('r4_bootstrap_config_signature_typechecks',diagnostics.length===0,{registryReturnType:returnType,warmUpParameterType:parameterType,exactCall,diagnostics,fixture,boundary:'Actual TypeScript semantic check of verbatim extracted signatures and call. Not a full-project tsc build.'});
}
{
  // Real temporary filesystem; controlled MySQL outcomes and deterministic interleaving.
  const tempDir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'mysql-mcp-r4-replay-'));
  let phase='seed',resumeReplay,signalReplayStarted;
  const replayStarted=new Promise(r=>signalReplayStarted=r),replayGate=new Promise(r=>resumeReplay=r);
  const mysqlDurableIds=[];
  const {AuditEngine:Engine}=load('packages/core-engine/src/audit-engine.ts',{'@mysql-mcp/security':{Masker:{maskSqlText:s=>s}}});
  const engine=new Engine({query:async(_sql,params)=>{
    const ids=params[0].map(row=>row[0]);
    if(phase==='seed'||ids.includes('r4-B'))throw new Error('controlled MySQL unavailable for fallback event');
    if(ids.includes('r4-A')){signalReplayStarted();await replayGate;mysqlDurableIds.push(...ids);return [{}]}
    throw new Error('unexpected query');
  }},{maxUnflushedEvents:100,batchSize:100,flushIntervalMs:10000,emergencyLogDir:tempDir});
  const submit=async id=>{const slot=await engine.reserveSlotOrBackpressure();await slot.commit({queryInstanceId:id,userId:'1',profileId:'1',sqlText:'SELECT 1',isHighRisk:false});await engine.flushBatch()};
  await submit('r4-A');const logPath=path.join(tempDir,fs.readdirSync(tempDir)[0]);
  phase='replay';const replay=engine.replayEmergencyLogsToDb(logPath);await replayStarted;
  await submit('r4-B');
  const idsBeforeUnlink=fs.readFileSync(logPath,'utf8').trim().split('\n').map(l=>JSON.parse(l).queryInstanceId);
  resumeReplay();const replayCount=await replay;
  const fileStillExists=fs.existsSync(logPath);
  const remainingFiles=fs.readdirSync(tempDir);
  const fallbackIds=remainingFiles.flatMap(f=>fs.readFileSync(path.join(tempDir,f),'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l).queryInstanceId));
  add('r4_replay_must_not_delete_concurrent_append',mysqlDurableIds.includes('r4-B')||fallbackIds.includes('r4-B'),{idsInFileBeforeReplayUnlink:idsBeforeUnlink,replayCount,mysqlDurableIds,fileStillExists,remainingFiles,fallbackIds,totalUnflushed:engine.totalUnflushedCount,tempDir,boundary:'Real filesystem and exact AuditEngine methods; MySQL insert outcomes are stubbed.'});
  await engine.stopAndFlushAll();
  const controlDir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'mysql-mcp-r4-replay-control-'));
  const controlFile=path.join(controlDir,'sealed.jsonl');
  fs.writeFileSync(controlFile,JSON.stringify({queryInstanceId:'control',sqlText:'SELECT 1',isHighRisk:false})+'\n');
  const controlIds=[];const control=new Engine({query:async(_sql,params)=>{controlIds.push(...params[0].map(row=>row[0]));return [{}]}},{maxUnflushedEvents:100,batchSize:100,flushIntervalMs:10000,emergencyLogDir:controlDir});
  const count=await control.replayEmergencyLogsToDb(controlFile);
  add('r4_sealed_file_replay_control',count===1&&controlIds.includes('control')&&!fs.existsSync(controlFile),{count,mysqlDurableIds:controlIds,fileStillExists:fs.existsSync(controlFile),boundary:'Control with no concurrent append; real filesystem, stubbed MySQL.'});
  await control.stopAndFlushAll();
}
results.newRound={total:results.tests.length-results.previousRounds.total,holds:results.tests.slice(results.previousRounds.total).filter(t=>t.invariantHolds).length,violated:results.tests.slice(results.previousRounds.total).filter(t=>!t.invariantHolds).length};

results.baseline=results.previousRounds;results.extended=results.newRound;delete results.previousRounds;delete results.newRound;results.summary={total:results.tests.length,holds:results.tests.filter(t=>t.invariantHolds).length,violated:results.tests.filter(t=>!t.invariantHolds).length};const output=process.env.REVIEW_EVIDENCE_FILE||path.join(__dirname,'backend-design-review-round4.evidence.json');fs.writeFileSync(output,JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
