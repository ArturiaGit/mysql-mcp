'use strict';
// Round 3: CR-01..CR-14 only; adapted from round-2 probes for explicit helper and SSH-manager imports.
// Preserves all prior specifications, scripts, reports and evidence; only writes round-3 evidence.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const names=['ARCHITECTURE_SPEC.md','FRONTEND_ARCHITECTURE_SPEC.md','BACKEND_ARCHITECTURE_SPEC.md','API_CONTRACT_SPEC.md'];
const shaFile=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const protectedPaths=[...names.map(n=>path.join(root,'docs',n)),...fs.readdirSync(__dirname).filter(n=>/^(cross-design-review(?:\.|-round2)|CROSS_DESIGN_REVIEW(?:\.|_ROUND2))/.test(n)).map(n=>path.join(__dirname,n)),...['arch_parts','fe_parts','be_parts','contract_parts'].flatMap(d=>fs.readdirSync(path.join(root,'scripts',d)).map(n=>path.join(root,'scripts',d,n)))];
const protectedHashes=Object.fromEntries(protectedPaths.map(p=>[p,shaFile(p)]));
const docs=Object.fromEntries(names.map(n=>[n,fs.readFileSync(path.join(root,'docs',n),'utf8')]));
const [arch,fe,be,api]=names.map(n=>docs[n]);
const observations=[];
const add=(id,issue,holds,actual,boundary='document extraction')=>observations.push({id,issue,holds:!!holds,actual,boundary});
class AppError extends Error{constructor(p){super(p.message);Object.assign(this,p);}}
function section(text,heading){const lines=text.split(/\r?\n/),start=lines.findIndex(l=>l.startsWith(heading));assert(start>=0,heading);const level=lines[start].match(/^#+/)[0].length;let end=start+1;while(end<lines.length){const m=lines[end].match(/^(#+) /);if(m&&m[1].length<=level)break;end++;}return lines.slice(start,end).join('\n');}
function blocks(text,heading){return [...section(text,heading).matchAll(/```(?:typescript|tsx?|json|sql)\r?\n([\s\S]*?)```/g)].map(m=>m[1]);}
function source(text,heading,contains){const s=blocks(text,heading).find(x=>x.includes(contains));assert(s,contains);return s;}
function load(code,overrides={},globals={}){const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;const ctx=vm.createContext({Buffer,setTimeout,clearTimeout,console,AbortController,AbortSignal,...globals});ctx.module={exports:{}};ctx.exports=ctx.module.exports;ctx.require=id=>{if(Object.hasOwn(overrides,id))return overrides[id];if(['@mysql-mcp/core-engine','./app-error'].includes(id))return {AppError};return require(id);};vm.runInContext(js,ctx);return ctx.module.exports;}
function jsonBlocks(text,heading){return [...section(text,heading).matchAll(/```json\r?\n([\s\S]*?)```/g)].map(m=>JSON.parse(m[1]));}
function routeLine(text,route,verb){const l=text.split(/\r?\n/).find(l=>l.includes('`'+route+'`')&&l.includes('`'+verb+'`'));assert(l,route);return l;}
function ddl(text){return Object.fromEntries([...text.matchAll(/CREATE TABLE `([^`]+)`\s*\(([\s\S]*?)\) ENGINE=/g)].map(m=>[m[1],[...m[2].matchAll(/^\s*`([^`]+)`\s+([^\n]+)/gm)].map(x=>({name:x[1],declaration:x[2]}))]));}
function typeNode(code,name){const f=ts.createSourceFile('dto.ts',code,ts.ScriptTarget.Latest,true);const n=f.statements.find(n=>ts.isInterfaceDeclaration(n)&&n.name.text===name);assert(n,name);return {file:f,node:n};}
function fieldInfo(code,name){const {file,node}=typeNode(code,name);return node.members.filter(ts.isPropertySignature).map(m=>({name:m.name.getText(file),type:m.type.getText(file),optional:!!m.questionToken}));}
function semanticDiagnostics(code,label){const typesRoot=path.dirname(path.dirname(require.resolve('@types/node/package.json')));const virtual=path.join(path.dirname(path.dirname(require.resolve('typescript/package.json'))),'cr-round3-'+label+'.ts');const options={strict:true,noEmit:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,moduleResolution:ts.ModuleResolutionKind.Node10,esModuleInterop:true,skipLibCheck:true,types:['node'],typeRoots:[typesRoot]};const host=ts.createCompilerHost(options),read=host.getSourceFile.bind(host);host.getSourceFile=(f,v,...rest)=>path.normalize(f)===path.normalize(virtual)?ts.createSourceFile(f,code,v,true):read(f,v,...rest);const p=ts.createProgram([virtual],options,host);return ts.getPreEmitDiagnostics(p).filter(d=>d.file&&path.normalize(d.file.fileName)===path.normalize(virtual)).map(d=>({code:d.code,line:d.file.getLineAndCharacterOfPosition(d.start).line+1,message:ts.flattenDiagnosticMessageText(d.messageText,'\n'),excerpt:d.file.text.split(/\r?\n/)[d.file.getLineAndCharacterOfPosition(d.start).line]}));}
let poolExports;
const sshKeyBlob=Buffer.from('review-owned-host-key-blob-for-deterministic-hex-base64-conversion');
const hostKeyHex=crypto.createHash('sha256').update(sshKeyBlob).digest('hex');
const hostKeyOpenSsh='SHA256:'+Buffer.from(hostKeyHex,'hex').toString('base64').replace(/=+$/,'');
async function connectivity(payload,savedOverride={},control={}){
 const options=[],dns=[],decrypted=[],direct=[],bareSockets=[],sshEvents=[];
 const saved={host:'db.example.test',port:3306,username:'reader',default_database:'app',password_encrypted:'DB_CIPHER',tls_config:{enabled:true,ca_cert:'PRIVATE_CA'},ssh_config:{use_ssh:false,host:'bastion.example.test',port:22,username:'tunnel',private_key_encrypted:'SSH_CIPHER',host_fingerprint_sha256:hostKeyOpenSsh},...savedOverride};
 const netStub={connect(opts){direct.push(opts);return {kind:'direct',connected:true}},Socket:class{constructor(){this.kind='unconnected-socket';this.connected=false;bareSockets.push(this);}}};
 const mysqlStub={createConnection(opts){options.push(opts);const conn={connect(cb){try{const stream=opts.stream();sshEvents.push({event:'mysql-stream',kind:stream.kind});}catch(e){cb(e);return;}cb(control.mysqlConnectError?Error('controlled MySQL connect failure'):null)},ping(cb){cb(control.mysqlPingError?Error('controlled MySQL ping failure'):null)},destroy(){sshEvents.push({event:'mysql-destroy'});}};return conn;}};
 const EventEmitter=require('node:events');
 class SshClient extends EventEmitter {
  connect(opts){sshEvents.push({event:'ssh-connect',host:opts.host,port:opts.port,username:opts.username,keySource:opts.privateKey==='SAVED_SSH_SECRET'?'decrypted-saved':opts.privateKey==='NEW_KEY'?'new':'other',hostHash:opts.hostHash});queueMicrotask(()=>{const observedHex=control.badHostKey?'0'.repeat(64):hostKeyHex;const accepted=opts.hostVerifier(observedHex);sshEvents.push({event:'host-verify',accepted,observedHex});if(!accepted)this.emit('error',Error('Host denied (verification failed)'));else this.emit('ready');});return this;}
  forwardOut(src,srcPort,host,port,cb){sshEvents.push({event:'forward-out',host,port});if(control.forwardError)cb(Error('controlled forward failure'));else cb(null,{kind:'authenticated-ssh-forward'});}
  end(){sshEvents.push({event:'ssh-end'});}
 }
 const guard={async resolveAndValidateHost(host){dns.push(host);if(host===control.deniedHost)throw new AppError({code:'ERR_SSRF_PROHIBITED',message:'controlled denied host'});return host.startsWith('db.')?'203.0.113.10':'203.0.113.20'}};
 const keyring={decrypt(v){decrypted.push(v);return v==='SSH_CIPHER'?'SAVED_SSH_SECRET':'SAVED_DB_SECRET'}};
 const sshModule=load(source(be,'### 8.6 ','class SshTunnelManager'),{ssh2:{Client:SshClient}});
 const sshManager=new sshModule.SshTunnelManager(keyring,guard);
 const m=load(source(be,'### 9.2 ','class ProfileConnectivityService'),{'node:net':netStub,mysql2:mysqlStub,'@mysql-mcp/core-engine':{AppError,toMysqlSslOptions:poolExports.toMysqlSslOptions}});
 const service=new m.ProfileConnectivityService({async findByIdOrThrow(){return saved}},keyring,guard,control.noManager?undefined:sshManager);
 let error=null,result=null;
 try{result=await service.testMysqlConnectivity(payload);}catch(e){error={code:e.code??null,message:e.message};}
 return {error,result,connections:options.length,password:options.at(-1)?.password,ssl:options.at(-1)?.ssl??null,dns,decrypted,direct,bareSocketCount:bareSockets.length,sshEvents};
}
async function realSshFingerprintCase(encoding,keys){
 const ssh2=require('ssh2');const {hostKeys,userKeys}=keys;
 const parsed=ssh2.utils.parseKey(hostKeys.private);const key=Array.isArray(parsed)?parsed[0]:parsed;
 const digest=crypto.createHash('sha256').update(key.getPublicSSH()).digest();
 const fingerprint=encoding==='openssh'?'SHA256:'+digest.toString('base64').replace(/=+$/,''):digest.toString('hex');
 const events=[],clients=new Set();let handle=null,error=null;
 const server=new ssh2.Server({hostKeys:[hostKeys.private]},client=>{
  clients.add(client);client.on('error',()=>{});client.on('close',()=>clients.delete(client));
  client.on('authentication',ctx=>ctx.method==='publickey'?ctx.accept():ctx.reject(['publickey']));
  client.on('ready',()=>events.push({event:'server-ready'}));
  client.on('tcpip',(accept,reject,info)=>{events.push({event:'server-forward-accepted',host:info.destIP,port:info.destPort});const stream=accept();stream.on('error',()=>{});});
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();
 const managerModule=load(source(be,'### 8.6 ','class SshTunnelManager'));
 const guard={async resolveAndValidateHost(host){events.push({event:'resolve',host});return host==='bastion.example.test'?'127.0.0.1':'203.0.113.10';}};
 const manager=new managerModule.SshTunnelManager({decrypt(){return userKeys.private}},guard);
 try{handle=await manager.openEphemeralTunnelStream({host:'bastion.example.test',port:address.port,username:'review',privateKey:userKeys.private,hostFingerprintSha256:fingerprint},'db.example.test',3306);events.push({event:'returned-channel',constructor:handle.stream.constructor.name});}
 catch(e){error={code:e.code??null,message:e.message};}
 finally{if(handle){handle.stream.on('error',()=>{});handle.stream.end();handle.close();}for(const client of clients)client.end();await new Promise(resolve=>server.close(resolve));}
 return {encoding,fingerprint,error,channelReturned:!!handle,events,ssh2:require('ssh2/package.json').version,boundary:'real ssh2 client/server over loopback and real host-key verification; server accepts forward channel in-process, no MySQL or target DB socket, no external SSH service'};
}
async function logoutCase(scenario){
 const code=source(fe,'### 4.1 ','class SessionRequestManager');const logs=[],requests=[],csrfCalls=[];let destroyed=false,cleared=0,redirect='';
 const csrfMod=load(source(be,'### 5.4 ','csrfPreValidationHook'));const good=csrfMod.generateCsrfToken('pepper','seed');
 const response=(status,body)=>({status,ok:status>=200&&status<300,json:async()=>body});
 const fetch=async(url,opts={})=>{if(url.endsWith('/csrf')){csrfCalls.push(url);return response(200,{csrfToken:good});}requests.push({url,headers:opts.headers??{}});if(scenario==='network-error')throw Error('controlled network failure');if(scenario==='http500')return response(500,{code:'ERR_INTERNAL_SERVER'});if(scenario==='permission403')return response(403,{code:'ERR_RBAC_FORBIDDEN'});try{await csrfMod.csrfPreValidationHook({method:opts.method,headers:opts.headers,cookies:{mcp_csrf_seed:'seed'},runtimeCtx:{config:{SERVER_PEPPER:'pepper'}}},{});}catch(e){return response(403,{code:e.code});}destroyed=true;return response(200,{success:true});};
 const m=load(code,{}, {fetch,console:{warn:(...args)=>logs.push(args.map(String).join(' ')),log(){}},queryClient:{clear(){cleared++;}},window:{location:{get href(){return redirect},set href(v){redirect=v;}}}});
 m.setActiveCsrfToken(scenario==='stale-token'?'STALE_TOKEN':good);
 await m.handleLogout();return {scenario,destroyed,cleared,redirect,requests,csrfRequests:csrfCalls.length,consoleWarnings:logs};
}
async function main(){
 const BaseForHelper=class{startTLS(){}};const ConnForHelper=class extends BaseForHelper{};poolExports=load(source(be,'### 8.1 ','class ManagedProfilePool'),{mysql2:{Connection:ConnForHelper}});

 // CR-01: compare all table/column declarations, not just presence of a few fields.
 const a=ddl(arch),b=ddl(be);const duplicates=Object.entries(a).flatMap(([t,cs])=>cs.filter((c,i)=>cs.findIndex(x=>x.name===c.name)!==i).map(c=>({table:t,column:c.name})));
 add('ddl_no_duplicate_columns','CR-01',duplicates.length===0,duplicates);
 const originallyMissing={sys_users:['apply_reason','password_updated_at','password_expires_days','version'],sys_roles:['is_builtin'],sys_profiles:['lower_case_table_names']};const missing=[];for(const [table,cols]of Object.entries(originallyMissing))for(const column of cols){if(!a[table]?.some(c=>c.name===column)||!b[table]?.some(c=>c.name===column))missing.push({table,column});}
 add('ddl_original_missing_columns_restored','CR-01',missing.length===0,{tables:Object.keys(b).length,checkedColumns:originallyMissing,missing},'bounded to original duplicate/missing-column findings; not enforcing pre-existing unrelated column-width/default equality');
 // CR-02: positive mapping checks plus actual pool/admin module wiring.
 for(const [id,tls,expected]of [['tls_disabled',{enabled:false},null],['tls_system_ca',{enabled:true},{rejectUnauthorized:true,verifyIdentity:true}],['tls_private_ca',{enabled:true,ca_cert:'PRIVATE_CA'},{ca:'PRIVATE_CA',rejectUnauthorized:true,verifyIdentity:true}]]){const r=await connectivity({host:'db.example.test',port:3306,user:'reader',password:'NEW',tls_config:tls});add(id,'CR-02',!r.error&&require('node:util').isDeepStrictEqual(JSON.parse(JSON.stringify(r.ssl)),expected),r,'document-code; captured mysql2 option only');}
 const poolSource=source(be,'### 8.1 ','class ManagedProfilePool'),adminSource=source(be,'### 8.2 ','class AdminMaintenanceChannel');
 const Base=class{startTLS(){}};const Conn=class extends Base{};const calls=[];const fakeTimers=[];const globals={setTimeout:(fn,ms)=>{const x={fn,ms};fakeTimers.push(x);return x;},clearTimeout:()=>{}};
 const mysqlStub={Connection:Conn,createPool(o){calls.push({kind:'pool',options:o});return{};},createConnection(o){calls.push({kind:'admin',options:o});return {connect(cb){cb(null)},query(sql,cb){cb(null)},destroy(){}};}};
 const poolModule=load(poolSource,{mysql2:mysqlStub},{...globals});let poolError=null;try{new poolModule.ManagedProfilePool('101',{name:'p',host:'db.example.test',port:3306,username:'reader',passwordEncrypted:'cipher',defaultDatabase:'app',maxPoolSize:1,queueTimeoutMs:1000,tlsConfig:{enabled:true,ca_cert:'CA'}},{decrypt:()=> 'SECRET'},{resolveAndValidateHost:async()=> '203.0.113.10'});}catch(e){poolError=e.message;}
 add('pool_tls_helper_resolves_in_module','CR-02',!poolError,{error:poolError,helperDeclaredOrImported:/import[^;]*\btoMysqlSslOptions\b|function toMysqlSslOptions/.test(poolSource),driverFactoryReached:calls.some(x=>x.kind==='pool')},'separate CommonJS module; no cross-module global helper injected');
 const adminModule=load(adminSource,{mysql2:mysqlStub,'./pool-manager':poolModule},globals);const admin=new adminModule.AdminMaintenanceChannel({decrypt:()=> 'SECRET'},{});let adminError=null;try{await admin.killQuery({profileId:'101',host:'db.example.test',port:3306,username:'reader',passwordEncrypted:'cipher',tlsConfig:{enabled:true},verifiedEndpoint:{logicalHost:'db.example.test',pinnedIp:'203.0.113.10',port:3306,useSsh:false}},7);}catch(e){adminError=e.message;}
 add('admin_tls_helper_resolves_in_module','CR-02',!adminError,{error:adminError,helperDeclaredOrImported:/import[^;]*\btoMysqlSslOptions\b|function toMysqlSslOptions/.test(adminSource),driverFactoryReached:calls.some(x=>x.kind==='admin')},'separate CommonJS module with timer double; real documented helper not injected');
 // CR-03: preserve the old TLS/host counterexamples, check the already-specified SSH tuple.
 for(const [id,payload,extra]of [
 ['tls_clear_requires_reentry',{profile_id:'101',tls_config:null},{}],
 ['tls_ca_change_requires_reentry',{profile_id:'101',tls_config:{enabled:true,ca_cert:'OTHER_CA'}},{}],
 ['host_change_requires_reentry',{profile_id:'101',host:'other.example.test'},{}],
 ['ssh_toggle_requires_reentry',{profile_id:'101',use_ssh:true},{}],
 ['ssh_host_change_requires_reentry',{profile_id:'101',ssh_host:'other-bastion.example.test'},{ssh_config:{use_ssh:true,host:'bastion.example.test',port:22,username:'tunnel',private_key_encrypted:'SSH_CIPHER',host_fingerprint_sha256:hostKeyOpenSsh}}],
 ['ssh_port_change_requires_reentry',{profile_id:'101',ssh_port:2222},{ssh_config:{use_ssh:true,host:'bastion.example.test',port:22,username:'tunnel',private_key_encrypted:'SSH_CIPHER',host_fingerprint_sha256:hostKeyOpenSsh}}],
 ['ssh_user_change_requires_reentry',{profile_id:'101',ssh_user:'other-user'},{ssh_config:{use_ssh:true,host:'bastion.example.test',port:22,username:'tunnel',private_key_encrypted:'SSH_CIPHER',host_fingerprint_sha256:hostKeyOpenSsh}}],
 ['ssh_fingerprint_change_requires_reentry',{profile_id:'101',ssh_host_fingerprint_sha256:'SHA256:changed'},{ssh_config:{use_ssh:true,host:'bastion.example.test',port:22,username:'tunnel',private_key_encrypted:'SSH_CIPHER',host_fingerprint_sha256:hostKeyOpenSsh}}]
 ]){const r=await connectivity(payload,extra);add(id,'CR-03',r.error?.code==='ERR_CREDENTIAL_REENTRY_REQUIRED'&&r.connections===0&&r.decrypted.length===0&&r.dns.length===0,r,'document-code; track rejection before decryption/DNS/driver creation');}
 const unchanged=await connectivity({profile_id:'101'});add('unchanged_profile_reuses_credential','CR-03',!unchanged.error&&unchanged.password==='SAVED_DB_SECRET',unchanged,'positive document-code control');
 // CR-04: using a bare unconnected socket is not evidence of an authenticated SSH forward.
 const savedSsh={use_ssh:true,host:'bastion.example.test',port:22,username:'tunnel',private_key_encrypted:'SSH_CIPHER',host_fingerprint_sha256:hostKeyOpenSsh};
 for(const [id,payload,savedOverride]of [
 ['ssh_new_profile_actual_forward',{host:'db.example.test',port:3306,user:'reader',password:'NEW',use_ssh:true,ssh_host:'bastion.example.test',ssh_port:22,ssh_user:'tunnel',ssh_private_key:'NEW_KEY',ssh_host_fingerprint_sha256:hostKeyOpenSsh},{}],
 ['ssh_saved_profile_actual_forward',{profile_id:'101'},{ssh_config:savedSsh}],
 ['ssh_draft_profile_actual_forward',{profile_id:'101',password:'NEW',use_ssh:true,ssh_host:'new-bastion.example.test',ssh_user:'tunnel',ssh_private_key:'NEW_KEY',ssh_host_fingerprint_sha256:hostKeyOpenSsh},{ssh_config:savedSsh}]
 ]){const r=await connectivity(payload,savedOverride);add(id,'CR-04',!r.error&&r.sshEvents.some(e=>e.event==='forward-out')&&r.sshEvents.some(e=>e.event==='host-verify'&&e.accepted)&&r.dns.includes(payload.ssh_host??savedSsh.host),r,'actual documented connectivity service and ephemeral SSH manager; controlled driver and SSH event client; hex hash callback follows installed ssh2 source; no real network in this observation');}
 // CR-04 controls: raw-hex is a diagnostic control, NOT the contract encoding or recommended remediation.
 for(const [mode,payload,savedOverride]of [
 ['new',{host:'db.example.test',port:3306,user:'reader',password:'NEW',use_ssh:true,ssh_host:'bastion.example.test',ssh_user:'tunnel',ssh_private_key:'NEW_KEY',ssh_host_fingerprint_sha256:hostKeyHex},{}],
 ['saved',{profile_id:'101'},{ssh_config:{...savedSsh,host_fingerprint_sha256:hostKeyHex}}],
 ['draft',{profile_id:'101',password:'NEW',use_ssh:true,ssh_host:'new-bastion.example.test',ssh_user:'tunnel',ssh_private_key:'NEW_KEY',ssh_host_fingerprint_sha256:hostKeyHex},{ssh_config:savedSsh}]
 ]){const r=await connectivity(payload,savedOverride);add('ssh_hex_'+mode+'_forward_control','CR-04',!r.error&&r.result?.reachable&&r.sshEvents.some(e=>e.event==='forward-out'&&e.host==='203.0.113.10')&&r.sshEvents.some(e=>e.event==='mysql-stream'&&e.kind==='authenticated-ssh-forward')&&r.sshEvents.some(e=>e.event==='ssh-end')&&r.direct.length===0&&(mode!=='saved'||r.decrypted.includes('SSH_CIPHER')),r,'controlled protocol adapter; unsupported raw-hex control diagnoses encoding mismatch and validates repaired forwarding/cleanup');}
 const sshControlPayload={host:'db.example.test',port:3306,user:'reader',password:'NEW',use_ssh:true,ssh_host:'bastion.example.test',ssh_user:'tunnel',ssh_private_key:'NEW_KEY',ssh_host_fingerprint_sha256:hostKeyHex};
 for(const [id,overrides,control,expected]of [
 ['ssh_wrong_host_key_rejected',{}, {badHostKey:true},'Host denied'],
 ['ssh_bastion_ssrf_rejected',{}, {deniedHost:'bastion.example.test'},'controlled denied host'],
 ['ssh_target_ssrf_rejected',{}, {deniedHost:'db.example.test'},'controlled denied host'],
 ['ssh_missing_fingerprint_rejected',{ssh_host_fingerprint_sha256:undefined},{},'启用 SSH'],
 ['ssh_manager_missing_fail_closed',{}, {noManager:true},'not configured'],
 ['ssh_forward_error_closes_client',{}, {forwardError:true},'forwardOut'],
 ['ssh_mysql_connect_error_closes_tunnel',{}, {mysqlConnectError:true},'connect failure'],
 ['ssh_mysql_ping_error_closes_tunnel',{}, {mysqlPingError:true},'ping failure']
 ]){const r=await connectivity({...sshControlPayload,...overrides},{},control);const early=!['ssh_mysql_connect_error_closes_tunnel','ssh_mysql_ping_error_closes_tunnel'].includes(id);const closed=!id.includes('closes')||r.sshEvents.some(e=>e.event==='ssh-end');add(id,'CR-04',r.error?.message.includes(expected)&&(!early||r.connections===0)&&closed,r,'actual documented manager/service with controlled guard/SSH/MySQL error events');}
 const ssh2Real=require('ssh2');const loopbackKeys={hostKeys:ssh2Real.utils.generateKeyPairSync('ed25519'),userKeys:ssh2Real.utils.generateKeyPairSync('ed25519')};
 for(const encoding of ['openssh','hex']){const r=await realSshFingerprintCase(encoding,loopbackKeys);add('real_ssh_'+encoding+'_fingerprint_'+(encoding==='hex'?'diagnostic_control':'accepted'),'CR-04',encoding==='openssh'?r.channelReturned:!r.error&&r.channelReturned,r,r.boundary);}
 // CR-05: happy path fixed; stale-CSRF retry, ordinary 403, server-error and network-error stay visible.
 for(const scenario of ['success','stale-token','permission403','http500','network-error']){const r=await logoutCase(scenario);let holds;if(['success','stale-token'].includes(scenario))holds=r.destroyed&&r.redirect==='/login';else if(scenario==='permission403')holds=r.requests.length===1&&r.csrfRequests===0&&r.redirect==='/login?warning=session_unconfirmed';else holds=!r.destroyed&&r.redirect==='/login?warning=session_unconfirmed';add('logout_'+scenario.replaceAll('-','_'),'CR-05',holds,r,'document-code with response/fetch doubles; exact success/warning redirects asserted; LoginView banner is a documented requirement, not a rendered-browser observation');}
 // CR-06..CR-10: derive checks from current declarations, not hardcoded repaired payloads.
 const dto=source(fe,'### 8.2 ','interface UserProfileDTO');
 const numericIds=[];for(const n of ['UserProfileDTO','AuditRecordDTO','DbAclRuleDTO','TableAclRuleDTO','ProfileOptionDTO','ProfileDTO'])for(const f of fieldInfo(dto,n))if(/^(id|\w+_id)$/.test(f.name)&&/\bnumber\b/.test(f.type))numericIds.push({interface:n,...f});
 add('all_frontend_entity_id_fields_are_strings','CR-06',numericIds.length===0,numericIds);
 const idRoutes=['/api/v1/approvals/:id/approve','/api/v1/users/:id/roles','/api/v1/roles','/api/v1/roles/:id'];const numericArrays=fe.split(/\r?\n/).filter(l=>idRoutes.some(r=>l.includes('`'+r+'`'))&&l.includes('number[]'));add('frontend_role_profile_id_arrays_are_strings','CR-06',numericArrays.length===0,numericArrays);
 for(const [id,route,verb,required,forbidden]of [
 ['profile_create_wire_fields','/api/v1/profiles','POST',['display_name','max_pool_size','profile_capacity_qpm'],['displayName','maxPoolSize','profileCapacityQpm']],
 ['role_create_wire_fields','/api/v1/roles','GET/POST',['role_name','display_name','profileIds'],[]],
 ['role_update_wire_fields','/api/v1/roles/:id','PUT/DELETE',['default_limit','max_limit','max_timeout_ms','user_qpm_limit'],['defaultLimit','maxLimit','maxExecutionTimeMs','userQuotaQpm']]
 ]){const line=routeLine(fe,route,verb);add(id,'CR-07',required.every(x=>line.includes(x))&&forbidden.every(x=>!line.includes(x)),{line,required,forbidden});}
 const roleBackend=routeLine(be,'/api/v1/roles/:id','PUT/DELETE');add('backend_role_wire_field_alignment','CR-07',roleBackend.includes('max_timeout_ms')&&!roleBackend.includes('maxExecutionTimeMs'),roleBackend);
 const tableFields=fieldInfo(dto,'TableAclRuleDTO'),tablePattern=tableFields.find(x=>x.name==='table_pattern'),ruleType=tableFields.find(x=>x.name==='rule_type');add('table_acl_pattern_and_rule_type','CR-08',tablePattern?.type==='string'&&ruleType?.type.includes('BLACKLIST')&&ruleType?.type.includes('WHITELIST')&&!tableFields.some(x=>x.name==='effect'||x.name==='table_name'),tableFields);
 const traffic=fieldInfo(dto,'AdminDashboardStatsDTO').find(x=>x.name==='profile_traffic');add('dashboard_profile_traffic_is_array','CR-09',traffic?.type.startsWith('Array<'),traffic);
 for(const [id,route]of [['user_status_request_has_version','/api/v1/users/:id/status'],['user_roles_request_has_version','/api/v1/users/:id/roles']]){const line=routeLine(fe,route,'PUT');add(id,'CR-10',/\{[^}]*\bversion\b/.test(line),line);}
 // CR-11: expiry guard fixed; route completeness and strict schema/DTO optionality must also agree.
 const guardText=section(fe,'### 4.2 ');add('frontend_expiry_guard_includes_natural_expiry','CR-11',guardText.includes('must_change_password === true || is_password_expired === true'),guardText.split('\n').find(l=>l.includes('第三关：')));
 const userFields=fieldInfo(dto,'UserProfileDTO');const zod=source(fe,'### 3.3 ','export const UserProfileSchema');const schemaFields=[...zod.matchAll(/^\s*(\w+):\s*(z\.[^\n]+),[^\n]*$/gm)].map(m=>({name:m[1],optional:m[2].includes('.optional()')}));assert(schemaFields.length>10);const optionalMismatch=schemaFields.flatMap(f=>{const d=userFields.find(d=>d.name===f.name);return d&&d.optional!==f.optional?[{field:f.name,schemaOptional:f.optional,dtoOptional:d.optional}]:[];});add('user_schema_dto_requiredness_matches','CR-11',optionalMismatch.length===0,optionalMismatch,'static extraction of independent schema optional() and DTO ?; no actual Zod runtime claimed');
 const policyRoutes=fe.split(/\r?\n/).filter(l=>l.includes('/api/v1/auth/password-policy'));add('frontend_password_policy_route_mapping','CR-11',policyRoutes.some(l=>l.includes('GET'))&&policyRoutes.some(l=>l.includes('PUT')),policyRoutes);
 // CR-12 and CR-13: closure limited to exactly the names/boundary found last round.
 add('original_rest_error_names_aligned','CR-12',!be.includes("'ERR_FORBIDDEN_ROLE'")&&!be.includes("'ERR_SELF_OPERATION_FORBIDDEN'")&&be.includes("'ERR_RBAC_FORBIDDEN'")&&be.includes("'ERR_SELF_ACTION_PROHIBITED'"),{oldRoleCode:be.includes("'ERR_FORBIDDEN_ROLE'"),oldSelfCode:be.includes("'ERR_SELF_OPERATION_FORBIDDEN'")});
 const shared=source(be,'### 3.3 ','// packages/shared-types/src/entities.ts'),runtime=source(be,'### 3.3 ','// packages/core-engine/src/utils/entity-id.ts');add('entity_normalizer_moved_to_runtime_package','CR-13',!shared.includes('export function')&&runtime.includes('export function toEntityId')&&!/import[^;]*\btoEntityId\b[^;]*from ['"]@mysql-mcp\/shared-types/.test(be),{pureTypeBlock:shared,runtimeFile:runtime.split('\n')[0]});
 // CR-14: all four formerly forbidden transitions; two valid controls; new repair must typecheck.
 const userSource=source(be,'### 4.4 ','class UserService');for(const [from,to]of [['PENDING','ACTIVE'],['PENDING','DISABLED'],['REJECTED','ACTIVE'],['REJECTED','DISABLED'],['ACTIVE','DISABLED'],['DISABLED','ACTIVE']]){let state=from,writes=0,audits=0,tombstones=0;const conn={async query(sql,args=[]){if(sql.includes('SELECT u.id'))return [[{id:'1001'}]];if(/^\s*SELECT/.test(sql))return [[{id:'1002',status:state,version:1}]];if(sql.includes('UPDATE sys_users')){state=args[0];writes++;return[{affectedRows:1}];}if(sql.includes('INSERT INTO sys_user_approvals'))audits++;return[{affectedRows:1}];}};const m=load(userSource,{'@mysql-mcp/core-engine':{AppError,toEntityId:x=>String(x)},'../repositories/base.repository':{withTransaction:async(pool,fn)=>fn(conn)}});const svc=new m.UserService({}, {markUserInvalidatedSync(){tombstones++;},async reloadUserAuthFromDb(){}},{cancelQueriesByUser(){}});let code=null;try{await svc.updateUserStatus('1002',to,1,'1001');}catch(e){code=e.code??e.message;}const forbidden=['PENDING','REJECTED'].includes(from);add('transition_'+from.toLowerCase()+'_to_'+to.toLowerCase(),'CR-14',forbidden?code==='ERR_INVALID_STATUS_TRANSITION'&&writes===0&&audits===0&&tombstones===0:!code&&state===to&&writes===1&&audits===1,{from,to,code,state,writes,audits,tombstones},'actual documented Service; controlled query results; no real transaction integration');}
 const errorTypes=source(be,'### 3.4 ','export type ErrorCode'),appSource=source(be,'### 3.4 ','export class AppError');
 const appClean=appSource.replace(/^import .*;\s*$/gm,'');
 const userClean=userSource.replace(/^import (?!type mysql2).*;\s*$/gm,'');
 const typedFixture=[errorTypes,appClean,`type EntityId=string;declare function toEntityId(raw:string|number|bigint):string;declare class RegistryHub{markUserInvalidatedSync(id:string):void;reloadUserAuthFromDb(id:string):Promise<void>;}declare class QueryLifecycleCoordinator{cancelQueriesByUser(id:string,reason:string):void;}declare function withTransaction<T>(pool:mysql2.Pool,fn:(conn:mysql2.PoolConnection)=>Promise<T>):Promise<T>;`,userClean].join('\n');
 const diagnostics=semanticDiagnostics(typedFixture,'user-status');add('user_status_repair_semantic_typecheck','CR-14',diagnostics.length===0,diagnostics,'real TypeScript 5.9.3 and mysql2/Node types; actual documented ErrorCode/AppError/UserService; only local imports stubbed');
 add('user_status_not_found_contract_code','CR-14',userSource.includes("code: 'ERR_NOT_FOUND'")&&!userSource.includes("'ERR_USER_NOT_FOUND'"),userSource.split('\n').filter(l=>l.includes('NOT_FOUND')));
 add('password_policy_settings_and_risk_confirmation','CR-11',fe.includes('passwordExpiresDays: null')&&fe.includes('我已知晓安全风险')&&fe.includes('个人设置页面'),fe.split('\n').filter(l=>l.includes('个人密码轮换策略设置')),'documented interaction flow only; not a rendered browser acceptance test');
 const zodFolder=path.dirname(require.resolve('zod/package.json'));
 const schemaFixture=`import { z } from ${JSON.stringify(zodFolder.replaceAll('\\','/'))};\n`+zod.replace(/^\s*import .*;\s*$/gm,'')+'\n'+typeNode(dto,'UserProfileDTO').node.getText()+`\ntype Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;const strictSchemaDtoEquality:Equal<InferredUserProfile,UserProfileDTO>=true;`;
 const schemaDiagnostics=semanticDiagnostics(schemaFixture,'schema-dto-equality');add('user_schema_dto_real_zod_type_equality','CR-11',schemaDiagnostics.length===0,{zod:require('zod/package.json').version,diagnostics:schemaDiagnostics},'real Zod inference and TypeScript strict equality; no browser or Vitest runner');
 const policyDto=fieldInfo(dto,'PasswordPolicyDTO'),policyResponse=jsonBlocks(api,'#### 6.1.7 ')[0];
 const missingPolicyFields=policyDto.filter(f=>!f.optional&&!Object.hasOwn(policyResponse,f.name)).map(f=>f.name);
 const unknownPolicyFields=Object.keys(policyResponse).filter(k=>!policyDto.some(f=>f.name===k));
 const policyFixture=typeNode(dto,'PasswordPolicyDTO').node.getText()+`\nconst actualContractResponse:PasswordPolicyDTO=${JSON.stringify(policyResponse)};`;
 const policyDiagnostics=semanticDiagnostics(policyFixture,'password-policy-wire-dto');
 add('password_policy_get_wire_response_matches_dto','CR-11',missingPolicyFields.length===0&&unknownPolicyFields.length===0&&policyDiagnostics.length===0,{route:routeLine(fe,'/api/v1/auth/password-policy','GET'),policyDto,policyResponse,missingPolicyFields,unknownPolicyFields,diagnostics:policyDiagnostics},'actual API contract JSON assigned to documented frontend response DTO; no adapter documented for this route');
 // Current emitted files must agree with their declared generation fragments.
 const assembly=[];for(const [file,generator,dir]of [['ARCHITECTURE_SPEC.md','combine_arch.js','arch_parts'],['FRONTEND_ARCHITECTURE_SPEC.md','combine_fe_spec.js','fe_parts'],['BACKEND_ARCHITECTURE_SPEC.md','combine_be_spec.js','be_parts'],['API_CONTRACT_SPEC.md','combine_contract.js','contract_parts']]){const gen=fs.readFileSync(path.join(root,'scripts',generator),'utf8');const parts=[...gen.matchAll(/["'](part[^"']+\.md)["']/g)].map(m=>m[1]);const built=parts.map(p=>fs.readFileSync(path.join(root,'scripts',dir,p),'utf8').trim()).join('\n\n---\n\n');assembly.push({file,parts:parts.length,exactTextMatch:built===docs[file]});}
 for(const [p,h]of Object.entries(protectedHashes))assert.equal(shaFile(p),h,'Changed protected input: '+p);
 const ids=Array.from({length:14},(_,i)=>'CR-'+String(i+1).padStart(2,'0'));const closure=ids.map(id=>({id,closed:observations.filter(x=>x.issue===id).every(x=>x.holds),passing:observations.filter(x=>x.issue===id&&x.holds).length,remaining:observations.filter(x=>x.issue===id&&!x.holds).map(x=>x.id)}));
 const result={review:'cross-design-round3-bounded',date:'2026-11-11',timezone:'Asia/Shanghai',runtime:process.version,typescript:ts.version,scope:ids,ssh2PrimarySource:{package:require('ssh2/package.json').version,clientPath:require.resolve('ssh2').replace(/lib[\\/]index\.js$/,'lib/client.js'),hexDigestPresent:fs.readFileSync(path.join(path.dirname(require.resolve('ssh2/package.json')),'lib/client.js'),'utf8').includes("createHash(hashAlgo).update(key).digest('hex')")},sourceHashes:Object.fromEntries(names.map(n=>[n,protectedHashes[path.join(root,'docs',n)]])),protectedInputsUnchanged:true,assembly,boundaries:{realMysql:false,realTLS:false,realSSH:'loopback ssh2 client/server only; no external service or DB target',realHttpServer:false,browser:false,wholeProjectBuild:false,full73ProbeSuite:false,changedAssertionsNotUsedAsIndependentProof:true,adaptations:['resolve TLS helper from documented exported pool module','inject actual documented SSH manager via new constructor parameter','model ssh2 hostHash callback as actual hex digest','require exact logout warning redirect'],additionalDependencies:{ssh2:require('ssh2/package.json').version,zod:require('zod/package.json').version}},observations,closure,summary:{total:observations.length,holds:observations.filter(x=>x.holds).length,violated:observations.filter(x=>!x.holds).length,closedIssues:closure.filter(x=>x.closed).length,remainingIssues:closure.filter(x=>!x.closed).length}};
 const out=path.join(__dirname,'cross-design-review-round3.evidence.json');fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.summary,null,2));console.log(closure.map(x=>x.id+' '+(x.closed?'CLOSED':'REMAINING: '+x.remaining.join(', '))).join('\n'));console.log(out);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
