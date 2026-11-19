const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const root=path.resolve(__dirname,'../..');
const names=['ARCHITECTURE_SPEC.md','FRONTEND_ARCHITECTURE_SPEC.md','BACKEND_ARCHITECTURE_SPEC.md','API_CONTRACT_SPEC.md'];
const docs=Object.fromEntries(names.map(n=>[n,fs.readFileSync(path.join(root,'docs',n),'utf8')]));
const sha=n=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'docs',n))).digest('hex');
const hashes=Object.fromEntries(names.map(n=>[n,sha(n)]));
const [arch,fe,be,api]=names.map(n=>docs[n]);
function section(text,heading){const lines=text.split(/\r?\n/);const start=lines.findIndex(l=>l.startsWith(heading));assert(start>=0,heading);const level=lines[start].match(/^#+/)[0].length;let end=start+1;while(end<lines.length){const h=lines[end].match(/^(#+) /);if(h&&h[1].length<=level)break;end++;}return lines.slice(start,end).join('\n');}
function block(text,heading,lang='typescript'){const s=section(text,heading),m=s.match(new RegExp('```'+lang+'\\r?\\n([\\s\\S]*?)```'));assert(m,heading+' code');return m[1];}
function loadTs(source,exports,bindings={}){const clean=source.replace(/^import .*;\s*$/gm,'').replace(/^\s*export /gm,'');const js=stripTypeScriptTypes(clean,{mode:'transform'});const ctx=vm.createContext({Buffer,crypto,setTimeout,clearTimeout,...bindings});vm.runInContext(js+'\nObject.assign(globalThis,{'+exports.join(',')+'});',ctx);return ctx;}
function firstJson(text,heading){return JSON.parse(block(text,heading,'json'));}
const observations=[];
function add(id,finding,kind,expected,actual,holds){observations.push({id,finding,kind,expected,actual,holds});}
class AppError extends Error{constructor(fields){super(fields.message);Object.assign(this,fields);}}
function schemas(text){const out={};for(const m of text.matchAll(/CREATE TABLE `([^`]+)`\s*\(([\s\S]*?)\) ENGINE=/g)){const columns=[...m[2].matchAll(/^\s*`([^`]+)`\s+[^\n]+/gm)].map(x=>x[1]);out[m[1]]={columns,line:text.slice(0,m.index).split('\n').length};}return out;}
function routeLine(text,route,verb){const line=text.split(/\r?\n/).find(l=>l.includes('`'+route+'`')&&l.includes('`'+verb+'`'));assert(line,route+' '+verb);return line;}
function requestFields(heading){const s=section(api,heading);const start=s.indexOf('请求体');assert(start>=0,heading);let tail=s.slice(start);const stop=tail.search(/\n- \*\*(?:请求示例|成功响应)/);if(stop>=0)tail=tail.slice(0,stop);const fields=[];for(const line of tail.split(/\r?\n/)){const m=line.match(/^\s*\| `([^`]+)`\s*\|[^|]+\|\s*(.*?)\s*\|/);if(m)fields.push({name:m[1],required:m[2].replaceAll('*','')==='是'});}assert(fields.length,heading);return fields;}
function comparePayload(heading,payload){const fields=requestFields(heading);return {missing:fields.filter(f=>f.required&&!(f.name in payload)).map(f=>f.name),unknown:Object.keys(payload).filter(k=>!fields.some(f=>f.name===k))};}
async function main(){
 const as=schemas(arch),bs=schemas(be);const dup=Object.entries(as).flatMap(([table,v])=>[...new Set(v.columns)].filter(c=>v.columns.filter(x=>x===c).length>1).map(column=>({table,column,line:v.line})));
 add('ddl_unique_columns','CR-01','static-extraction',[],dup,dup.length===0);
 const missing=Object.fromEntries(Object.entries(bs).map(([t,v])=>[t,v.columns.filter(c=>!as[t]?.columns.includes(c))]).filter(([t,v])=>v.length));
 add('ddl_schema_alignment','CR-01','static-extraction',{},missing,Object.keys(missing).length===0);
 add('backend_ddl_control',null,'control',0,Object.values(bs).flatMap(v=>v.columns.filter((c,i)=>v.columns.indexOf(c)!==i)).length,Object.values(bs).every(v=>new Set(v.columns).size===v.columns.length));
 const csrf=loadTs(block(be,'### 5.4 '),['csrfPreValidationHook','generateCsrfToken'],{AppError});
 const logoutCode=[...section(fe,'### 4.1 ').matchAll(/```ts\r?\n([\s\S]*?)```/g)].map(m=>m[1]).find(s=>s.includes('class SessionRequestManager'));assert(logoutCode);const logoutCalls=[];let destroyed=false,redirect='',clears=0;
 const logout=loadTs(logoutCode,['handleLogout'],{AbortController,AbortSignal,queryClient:{clear(){clears++;}},window:{location:{get href(){return redirect},set href(v){redirect=v}}},fetch:async(url,opts={})=>{if(url.includes('/csrf'))return{ok:true,status:200,json:async()=>({csrfToken:csrf.generateCsrfToken('pepper','seed')}),headers:{get:()=>csrf.generateCsrfToken('pepper','seed')}};const req={method:opts.method??'GET',headers:opts.headers??{},cookies:{mcp_csrf_seed:'seed'},runtimeCtx:{config:{SERVER_PEPPER:'pepper'}}};let error=null;try{await csrf.csrfPreValidationHook(req,{});if(url.includes('/logout'))destroyed=true;}catch(e){error=e.code;}logoutCalls.push({url,headers:req.headers,error});return{ok:!error,status:error?403:200,json:async()=>({success:!error})};}});
 await logout.handleLogout();
 add('logout_csrf_end_to_end','CR-05','document-code-execution',{sessionDestroyed:true,redirect:'/login'},{sessionDestroyed:destroyed,redirect,cacheClears:clears,requests:logoutCalls},destroyed);
 const goodReq={method:'POST',headers:{'x-csrf-token':csrf.generateCsrfToken('pepper','seed')},cookies:{mcp_csrf_seed:'seed'},runtimeCtx:{config:{SERVER_PEPPER:'pepper'}}};await csrf.csrfPreValidationHook(goodReq,{});add('csrf_valid_header_control',null,'control','ALLOW','ALLOW',true);
 const connectivitySource=block(be,'### 9.2 ');
 const connects=[],network=[],decrypt=[];
 const serviceCtx=loadTs(connectivitySource,['ProfileConnectivityService'],{AppError,mysql2:{createConnection(options){connects.push(options);return {connect(cb){cb(null)},ping(cb){cb(null)},destroy(){}}}},net:{connect(opts){network.push(opts);return {}}}});
 const saved={host:'db.example.test',port:3306,username:'reader',default_database:'app',password_encrypted:'enc',tls_config:{enabled:true,ca_cert:'PRIVATE_CA'},ssh_config:{use_ssh:true,host:'bastion.example.test',port:22}};
 const service=new serviceCtx.ProfileConnectivityService({async findByIdOrThrow(){return saved}},{decrypt(v){decrypt.push(v);return 'SAVED_SECRET'}},{async resolveAndValidateHost(host){return '203.0.113.10'}});
 async function testConnection(payload){const before=connects.length;let error=null;try{await service.testMysqlConnectivity(payload);}catch(e){error=e.code||e.message;}return {error,connection:connects.length>before?connects.at(-1):null};}
 let result=await testConnection({host:saved.host,port:3306,user:'reader',password:'NEW_SECRET',tls_config:{enabled:false}});
 add('tls_disabled_wire_mapping','CR-02','document-code-execution','no ssl option',{sslPresent:!!result.connection?.ssl,ssl:result.connection?.ssl??null},!result.connection?.ssl);
 result=await testConnection({host:saved.host,port:3306,user:'reader',password:'NEW_SECRET',tls_config:{enabled:true,ca_cert:'PRIVATE_CA'}});
 add('tls_custom_ca_wire_mapping','CR-02','document-code-execution','ssl.ca === PRIVATE_CA',{ssl:result.connection?.ssl??null},result.connection?.ssl?.ca==='PRIVATE_CA');
 result=await testConnection({profile_id:'101',tls_config:null});
 add('tls_change_requires_credential','CR-03','document-code-execution','ERR_CREDENTIAL_REENTRY_REQUIRED',{error:result.error,oldPasswordUsed:result.connection?.password==='SAVED_SECRET',sslPresent:!!result.connection?.ssl},result.error==='ERR_CREDENTIAL_REENTRY_REQUIRED');
 result=await testConnection({profile_id:'101',host:'changed.example.test'});add('host_change_reentry_control',null,'control','ERR_CREDENTIAL_REENTRY_REQUIRED',result.error,result.error==='ERR_CREDENTIAL_REENTRY_REQUIRED');
 result=await testConnection({profile_id:'101'});add('unchanged_credential_reuse_control',null,'control','saved credential reused',result.error===null&&result.connection.password==='SAVED_SECRET',result.error===null&&result.connection.password==='SAVED_SECRET');
 const fields=['use_ssh','ssh_host','ssh_port','ssh_user','ssh_private_key','ssh_host_fingerprint_sha256'];
 const supplied={host:saved.host,port:3306,user:'reader',password:'NEW_SECRET',use_ssh:true,ssh_host:'bastion.example.test',ssh_port:22,ssh_user:'tunnel',ssh_private_key:'NEW_KEY',ssh_host_fingerprint_sha256:'SHA256:approved'};
 result=await testConnection(supplied);if(result.connection?.stream)result.connection.stream();
 add('ssh_test_uses_requested_path','CR-04','document-code-execution','verified SSH stream',{error:result.error,directSockets:network,unreferencedPayloadFields:fields.filter(f=>!connectivitySource.includes('payload.'+f))},network.length===0&&fields.every(f=>connectivitySource.includes('payload.'+f)));
 const profileOption=firstJson(api,'#### 6.5.2 ');
 const feOption=block(fe,'### 8.2 ','ts').match(/export interface ProfileOptionDTO\s*\{([\s\S]*?)\}/)[1];
 add('profile_option_id_contract','CR-06','static-extraction','string',{wireType:typeof profileOption[0].id,frontendIdDeclaration:feOption.match(/id:\s*\w+/)[0]},typeof profileOption[0].id==='string'&&feOption.includes('id: string'));
 const feRoleLine=routeLine(fe,'/api/v1/approvals/:id/approve','POST');add('approval_id_array_contract','CR-06','static-extraction','roleIds: string[]',feRoleLine,!feRoleLine.includes('number[]'));
 for(const [id,heading,route,verb,payload] of [
 ['profile_create_fields','#### 6.5.3 ','/api/v1/profiles','POST',{name:'db1',display_name:'Database',host:'db',port:3306,user:'reader',password:'secret',database:'app',max_pool_size:10,profile_capacity_qpm:300}],
 ['role_create_fields','#### 6.6.2 ','/api/v1/roles','GET/POST',{role_name:'ANALYST_CUSTOM',display_name:'x',profileIds:['101']}],
 ['role_update_fields','#### 6.6.3 ','/api/v1/roles/:id','PUT/DELETE',{default_limit:50,max_limit:500,max_timeout_ms:15000,user_qpm_limit:60,version:1}]
 ]){const line=routeLine(fe,route,verb);for(const k of Object.keys(payload))assert(line.includes(k),`${id}: ${k} is not documented`);const diff=comparePayload(heading,payload);add(id,'CR-07','contract-table-model',{missing:[],unknown:[]},{...diff,frontendRouteLine:line},!diff.missing.length&&!diff.unknown.length);}
 const rules=firstJson(api,'#### 6.6.5 ').rules;const feTable=block(fe,'### 8.2 ','ts').match(/export interface TableAclRuleDTO\s*\{([\s\S]*?)\}/)[1];
 add('table_acl_wire_fields','CR-08','static-extraction',['table_pattern','rule_type'],{wireFields:Object.keys(rules[0]),frontendDefinition:feTable.trim()},feTable.includes('table_pattern')&&feTable.includes('rule_type'));
 const statsSection=section(api,'#### 6.8.2 ');const fixtures=[...statsSection.matchAll(/```json\r?\n([\s\S]*?)```/g)].map(m=>JSON.parse(m[1]));const adminStats=fixtures.find(x=>'profile_traffic' in x);assert(adminStats);const feStats=block(fe,'### 8.2 ','ts').match(/export interface AdminDashboardStatsDTO\s*\{([\s\S]*?)\n\}/)[1];
 add('dashboard_profile_traffic_shape','CR-09','static-extraction','array',{wireIsArray:Array.isArray(adminStats.profile_traffic),frontendProperty:feStats.slice(feStats.indexOf('profile_traffic:')).trim()},Array.isArray(adminStats.profile_traffic)===/profile_traffic:\s*(?:Array<|\{[\s\S]*?\}\[\])/.test(feStats));
 for(const [id,heading,route,payload] of [['user_status_cas','#### 6.3.2 ','/api/v1/users/:id/status',{status:'DISABLED'}],['user_roles_cas','#### 6.3.3 ','/api/v1/users/:id/roles',{roleIds:['2']}]]){const line=routeLine(fe,route,'PUT');const diff=comparePayload(heading,payload);add(id,'CR-10','contract-table-model','version required by both documents',{frontendRouteLine:line,missingRequiredFields:diff.missing},line.includes('version'));}
 const user=firstJson(api,'### 4.3 ');user.must_change_password=false;user.is_password_expired=true;
 const guard=loadTs(block(be,'### 5.5 '),['fourTierSecurityGuard'],{AppError});
 let backendDecision='ALLOW';try{await guard.fourTierSecurityGuard({method:'GET',url:'/api/v1/pats',routeOptions:{url:'/api/v1/pats',config:{}},currentUser:{...user,password_updated_at:'2000-01-01T00:00:00.000Z',password_expires_days:90}},{});}catch(e){backendDecision=e.code;}
 const feUserDef=block(fe,'### 8.2 ','ts').match(/export interface UserProfileDTO\s*\{([\s\S]*?)\}/)[1];const frontendRequiresChange=user.status==='ACTIVE'&&(user.must_change_password===true||user.is_password_expired===true);
 add('password_expiry_guard_alignment','CR-11','mixed:document-backend-code+frontend-rule',{frontendRequiresChange:true,backendDecision:'ERR_MUST_CHANGE_PASSWORD'},{frontendRequiresChange,backendDecision,missingDtoFields:['is_password_expired','password_expires_at','password_expires_days','reject_reason','version'].filter(f=>!feUserDef.includes(f))},frontendRequiresChange);
 const backendCodes=['ERR_RBAC_FORBIDDEN','ERR_SELF_ACTION_PROHIBITED'];const contractCodes=['ERR_RBAC_FORBIDDEN','ERR_SELF_ACTION_PROHIBITED'];
 add('error_code_vocabulary','CR-12','static-extraction',contractCodes,{backendCodes:backendCodes.filter(c=>be.includes("'"+c+"'")),contractCodes:contractCodes.filter(c=>api.includes(c)),backendCodesInContract:backendCodes.filter(c=>api.includes(c))},backendCodes.every(c=>api.includes(c)));
 const shared=block(be,'### 3.3 ');add('shared_types_type_only_boundary','CR-13','static-extraction','type-only module',{runtimeExportInEntities:/export function toEntityId/.test(shared),frontendForbidsRuntime:true,backendValueImport:/import \{ toEntityId, type EntityId \} from '@mysql-mcp\/shared-types'/.test(be)},!/export function/.test(shared));

 const userServiceSource=block(be,'### 4.4 ');
 assert(section(api,'#### 6.3.2 ').includes('ERR_INVALID_STATUS_TRANSITION'));
 for(const from of ['PENDING','REJECTED','ACTIVE','DISABLED']){
   let state=from;const statements=[];
   const conn={async query(sql,params=[]){statements.push(sql);if(sql.includes('SELECT u.id')&&sql.includes('SUPER_ADMIN'))return [[{id:'1001'}]];if(/^\s*SELECT/.test(sql))return [[{id:'1002',status:state,version:1}]];if(sql.includes('UPDATE sys_users')){state=params[0];return [{affectedRows:1}];}return [{affectedRows:1}];}};
   const userCtx=loadTs(userServiceSource,['UserService'],{AppError,toEntityId:v=>BigInt(String(v)).toString(),withTransaction:async(pool,fn)=>fn(conn)});
   const svc=new userCtx.UserService({}, {markUserInvalidatedSync(){},async reloadUserAuthFromDb(){}}, {cancelQueriesByUser(){}});
   let error=null;try{await svc.updateUserStatus('1002',from==='ACTIVE'?'DISABLED':'ACTIVE',1,'1001');}catch(e){error=e.code||e.message;}
   const forbidden=from==='PENDING'||from==='REJECTED';
   // ACTIVE->DISABLED and DISABLED->ACTIVE are the permitted controls.
   add('status_transition_'+from.toLowerCase(),forbidden?'CR-14':null,forbidden?'document-code+transaction-double':'control',forbidden?'ERR_INVALID_STATUS_TRANSITION':'ALLOW',{from,to:from==='ACTIVE'?'DISABLED':'ACTIVE',error,finalState:state,statements},forbidden?error==='ERR_INVALID_STATUS_TRANSITION':error===null);
 }
 for(const n of names)assert.equal(sha(n),hashes[n],`review mutated ${n}`);
 let driverInspection=null;try{const packagePath=require.resolve('mysql2/package.json');const driverFile=path.join(path.dirname(packagePath),'lib/base/connection.js');const driverSource=fs.readFileSync(driverFile,'utf8');driverInspection={version:require(packagePath).version,file:driverFile,sha256:crypto.createHash('sha256').update(driverSource).digest('hex'),usesSslCa:driverSource.includes('ca: ssl.ca'),usesCaCert:driverSource.includes('ssl.ca_cert')};}catch{}
 const evidence={driverInspection,date:'2026-11-09',timezone:'Asia/Shanghai',scope:names,sha256:hashes,runtime:process.version,boundaries:{productionImplementationPresent:false,realMysql:false,realTlsOrSsh:false,liveHttpServer:false,contractChecks:'Markdown extraction; contract-table model is not a Fastify schema',historicalReportsModified:false},observations,summary:{total:observations.length,holds:observations.filter(x=>x.holds).length,violated:observations.filter(x=>!x.holds).length,findings:new Set(observations.filter(x=>!x.holds).map(x=>x.finding)).size}};
 const output=process.env.CROSS_REVIEW_EVIDENCE_FILE||path.join(__dirname,'cross-design-review.evidence.json');fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence.summary,null,2));console.log(output);
}
main().catch(e=>{console.error(e);process.exitCode=1});


