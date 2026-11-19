'use strict';
// Bounded independent re-review; never overwrites specifications or prior evidence.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const prefix='database-design-review-round2';
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const protectedFiles=['docs','scripts'].flatMap(d=>files(path.join(root,d))).filter(p=>!path.basename(p).startsWith(prefix)&&path.basename(p)!=='DATABASE_DESIGN_REVIEW_ROUND2.md');
const before=Object.fromEntries(protectedFiles.map(p=>[p,hash(p)]));
const be=read('docs/BACKEND_ARCHITECTURE_SPEC.md'),db=read('docs/DATABASE_DESIGN_SPEC.md');
const api=read('docs/API_CONTRACT_SPEC.md'),fe=read('docs/FRONTEND_ARCHITECTURE_SPEC.md');
const observations=[];
function test(name,f){observations.push({name,passed:true,actual:f()});}
function block(heading,marker){const start=be.indexOf(heading);assert(start>=0);const end=be.indexOf('\n### ',start+1);const m=[...be.slice(start,end).matchAll(/```typescript\n([\s\S]*?)```/g)].find(x=>x[1].includes(marker));assert(m);return m[1];}
const snapshotCode=block('### 6.2 ','class SnapshotBuilder');
const limiterCode=block('### 6.4 ','class DualBucketRateLimiter');
class AppError extends Error{constructor(p){super(p.message);Object.assign(this,p);}}
let clock=1000000;
class TestDate extends Date{static now(){return clock;}}
function load(code,names){const js=stripTypeScriptTypes(code,{mode:'transform'}).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');return vm.runInNewContext(`${js}\n;({${names.join(',')}})`,{AppError,crypto,Date:TestDate,AbortController,setTimeout,clearTimeout},{timeout:2000});}
const current=load(snapshotCode,['SnapshotBuilder','mapUserRateLimit']);
const {DualBucketRateLimiter}=load(limiterCode,['DualBucketRateLimiter']);
function snap(row,roleQpms=[60],gq=100,gb=10,module=current){return module.SnapshotBuilder.buildSnapshot({
  requestId:'round2',user:{id:'9007199254740993',username:'fixture',status:'ACTIVE',mustChangePassword:false,authVersion:1,roleIds:roleQpms.map((_,i)=>String(i+1))},
  pat:{id:'9007199254740995',expiresAt:null,isRevoked:false},
  roles:roleQpms.map((q,i)=>({id:String(i+1),roleName:'R'+i,defaultLimit:5,maxLimit:10,maxTimeoutMs:1000,userQpmLimit:q,maxInflightConcurrency:2})),
  userRateLimit:module.mapUserRateLimit(row),globalRateLimit:{qpmLimit:gq,burstCapacity:gb,loopBreakerThreshold:3,loopBreakerWindowSec:30},
  profile:{id:'9007199254740997',name:'fixture',defaultDatabase:'test',capacityQpm:10000,maxPoolSize:5,maxInflightConcurrency:2,queueTimeoutMs:1000,status:'ACTIVE',lowerCaseTableNames:0},
  dbAclRows:[],tableAclRows:[],globalPolicyVersion:1});}
function acquire(limiter,s,profileCapacityQpm=10000){limiter.acquireOrThrow({userId:s.userId,userQpmLimit:s.quotas.userQpmLimit,userBurstCapacity:s.quotas.userBurstCapacity,profileId:s.effectiveProfile.id,profileCapacityQpm});}
function route(r){const l=db.split('\n').find(l=>l.startsWith('| `'+r+'` |'));assert(l,r);return l;}
test('USER row mapping remains paired, absence is null',()=>{
  assert.equal(current.mapUserRateLimit(null),null);const row={qpm_limit:30,burst_capacity:1};const out=current.mapUserRateLimit(row);
  assert.equal(out.qpmLimit,30);assert.equal(out.burstCapacity,1);assert.equal(row.qpm_limit,30);return {row,mapped:out};
});
test('Independent quota/burst boundary grid and actual token-bucket rejection',()=>{
  const results=[];
  for(const q of [-1,1,30,10000])for(const burst of [1,20,500])for(const globalBurst of [1,500]){
    const s=snap({qpm_limit:q,burst_capacity:burst},[60],100,globalBurst);
    assert.equal(s.quotas.userQpmLimit,q);assert.equal(s.quotas.userBurstCapacity,burst);
    if(q!==-1){const bucket=new DualBucketRateLimiter();for(let i=0;i<burst;i++)acquire(bucket,s);assert.throws(()=>acquire(bucket,s),e=>e.code==='ERR_RATE_LIMIT_USER');}
    results.push({qpm:q,userBurst:burst,globalBurst,actualBurst:s.quotas.userBurstCapacity,finiteBucketChecked:q!==-1});
  }
  return {combinations:results.length,finiteBucketCases:results.filter(r=>r.finiteBucketChecked).length,results};
});
test('Existing bucket shrinks after constructing a fresh updated snapshot',()=>{
  const l=new DualBucketRateLimiter();acquire(l,snap({qpm_limit:60,burst_capacity:20}));
  const fresh=snap({qpm_limit:30,burst_capacity:1});acquire(l,fresh);assert.throws(()=>acquire(l,fresh),e=>e.code==='ERR_RATE_LIMIT_USER');
  return {freshQuotas:fresh.quotas,automaticInvalidationTested:false};
});
test('Remove coverage restores role QPM and GLOBAL burst; global changes do not replace role QPM',()=>{
  const a=snap(null,[60],100,500),b=snap(null,[60],20,10);
  assert.equal(a.quotas.userQpmLimit,60);assert.equal(b.quotas.userQpmLimit,60);
  assert.equal(a.quotas.userBurstCapacity,500);assert.equal(b.quotas.userBurstCapacity,10);
  assert(api.includes('GLOBAL QPM 变更不会覆盖已有的角色配额'));
  assert(!api.includes('后续全局限流变更将对该用户自动联动生效'));
  assert(fe.includes('不能从 USER 配置接口的 null 或全局默认推算'));
  assert(db.includes('未签署前不冻结联调基线'));
  return {before:a.quotas,after:b.quotas,signoffStillRequired:true};
});
test('Role maximum, unlimited role, USER override, no-role deny and Profile protection retained',()=>{
  assert.equal(snap(null,[5,30],100).quotas.userQpmLimit,30);
  assert.equal(snap(null,[5,-1],100).quotas.userQpmLimit,-1);
  assert.equal(snap({qpm_limit:5,burst_capacity:1},[5,-1]).quotas.userQpmLimit,5);
  assert.throws(()=>snap(null,[]),e=>e.code==='ERR_RBAC_FORBIDDEN');
  const s=snap({qpm_limit:-1,burst_capacity:1}),l=new DualBucketRateLimiter();acquire(l,s,1);assert.throws(()=>acquire(l,s,1),e=>e.code==='ERR_RATE_LIMIT_PROFILE');
  assert.equal(s.userId,'9007199254740993');assert.equal(s.effectiveProfile.lowerCaseTableNames,0);
  assert.equal(s.quotas.loopBreakerThreshold,3);assert.equal(s.quotas.loopBreakerWindowSec,30);
  return 'Existing policy precedence, bounded Profile protection and string IDs preserved';
});
test('Corrected CSRF and USER route mappings match requested fixes',()=>{
  const csrf=route('GET /api/v1/auth/csrf');assert(csrf.includes('不注销Session'));assert(csrf.includes('不写业务库'));assert(!csrf.includes('注销会话'));
  assert(route('POST /api/v1/auth/logout').includes('注销会话'));
  const get=route('GET /api/v1/rate-limits/users/:id');assert(get.includes('sys_rate_limits(USER)'));assert(get.includes('revision=version=0'));assert(get.includes('只读'));
  const put=route('PUT /api/v1/rate-limits/users/:id'),del=route('DELETE /api/v1/rate-limits/users/:id');
  for(const line of [put,del]){assert(line.includes('sys_rate_limit_revisions'));assert(line.includes('USER revision CAS'));assert(line.includes('不以sys_users.version做CAS'));assert(line.includes('不删除PAT'));}
  assert(put.includes('rule/counter同事务更新'));assert(del.includes('保留counter'));assert(del.includes('不重置用户版本'));
  return {csrf,get,put,delete:del};
});
test('Counterfactual controls detect global-only burst assignment and dropped mapping',()=>{
  const expression='userBurstCapacity: params.userRateLimit?.burstCapacity ?? params.globalRateLimit?.burstCapacity,';
  assert(snapshotCode.includes(expression));
  const faulty=load(snapshotCode.replace(expression,'userBurstCapacity: params.globalRateLimit?.burstCapacity,'),['SnapshotBuilder','mapUserRateLimit']);
  const bad=snap({qpm_limit:30,burst_capacity:1},[60],100,500,faulty);
  assert.equal(bad.quotas.userBurstCapacity,500);assert.notEqual(bad.quotas.userBurstCapacity,1);
  const lost=load(snapshotCode.replace('burstCapacity: row.burst_capacity,','burstCapacity: undefined,'),['SnapshotBuilder','mapUserRateLimit']);
  assert.equal(snap({qpm_limit:30,burst_capacity:1},[60],100,500,lost).quotas.userBurstCapacity,500);
  return {mutantsDetected:2,note:'In-memory test controls only; no document edited and not new defects'};
});
function command(exe,args,env={}){const r=spawnSync(exe,args,{cwd:root,env:{...process.env,...env},encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});assert.equal(r.status,0,r.stderr||r.stdout||String(r.error));return {stdout:r.stdout.trim(),stderr:r.stderr.trim()};}
const staticCheck=command('python',['scripts/validate_database_design.py']);
const mutationTests=command('python',['-B','scripts/test_validate_database_design.py']);
// Only redirect evidence output. Source, assertions, fixture inputs and schedules are unmodified.
function rerunRedirect(script,oldName,newName,args=[]){
  const absolute=path.join(root,script);assert.equal(read(script).split(oldName).length-1,1,'Ambiguous output redirect');
  const launcher=`const fs=require('node:fs'),M=require('node:module');const file=${JSON.stringify(absolute)};const code=fs.readFileSync(file,'utf8').replace(${JSON.stringify(oldName)},${JSON.stringify(newName)});const m=new M(file);m.filename=file;m.paths=M._nodeModulePaths(require('node:path').dirname(file));m._compile(code,file);`;
  const result=command(process.execPath,['-e',launcher,...(args.length?['--',...args]:[])]);
  const evidence=JSON.parse(fs.readFileSync(path.join(__dirname,newName),'utf8'));
  return {script,evidenceFile:newName,summary:evidence.summary,stderr:result.stderr,adaptation:'Only evidence output basename redirected; assertions unchanged'};
}
const suites=[];
// The compiled module reads process.argv.includes('--typecheck').
suites.push(rerunRedirect('docs/reviews/database-design-remediation.test.cjs','database-design-remediation.evidence.json',prefix+'.remediation.evidence.json',process.argv.includes('--typecheck')?['--typecheck']:[]));
if(process.argv.includes('--historical')){
  suites.push(rerunRedirect('docs/reviews/cross-design-review-round4.repro.cjs','cross-design-review-round4.evidence.json',prefix+'.cross-regression.evidence.json'));
  const filename=path.join(__dirname,prefix+'.backend-regression.evidence.json');
  command(process.execPath,['docs/reviews/backend-design-review-round8.repro.cjs'],{REVIEW_EVIDENCE_FILE:filename});
  suites.push({script:'docs/reviews/backend-design-review-round8.repro.cjs',evidenceFile:path.basename(filename),summary:JSON.parse(fs.readFileSync(filename,'utf8')).summary,adaptation:'Existing REVIEW_EVIDENCE_FILE override only'});
}
for(const [p,h]of Object.entries(before))assert.equal(hash(p),h,'Changed protected file: '+p);
const focus=['docs/ARCHITECTURE_SPEC.md','docs/BACKEND_ARCHITECTURE_SPEC.md','docs/FRONTEND_ARCHITECTURE_SPEC.md','docs/API_CONTRACT_SPEC.md','docs/DATABASE_DESIGN_SPEC.md','docs/sql/001_metadata_schema.sql','scripts/validate_database_design.py','scripts/test_validate_database_design.py'];
const original=JSON.parse(read('docs/reviews/database-design-review.evidence.json'));
const oldHashes=Object.fromEntries(original.sources.map(s=>[s.path,s.sha256]));
const sources=focus.map(p=>({path:p,sha256:hash(path.join(root,p)),bytes:fs.statSync(path.join(root,p)).size,unchangedSinceRound1:oldHashes[p]===undefined?null:oldHashes[p]===hash(path.join(root,p))}));
const evidence={review:'database-design-round2-bounded',date:'2026-11-12',timezone:'Asia/Shanghai',runtime:process.version,
  scope:['DB-R1-01','DB-R1-02','DB-R1-03','DB-R1-04','related policy and documentation regression'],
  sources,observations,staticCheck,mutationTests,suites,
  closure:[{id:'DB-R1-01',documentAndSnippet:'closed',integration:'pending'},{id:'DB-R1-02',documentConflict:'closed',productAndInterfaceSignoff:'pending'},{id:'DB-R1-03',documentMapping:'closed',httpTest:'pending'},{id:'DB-R1-04',documentMapping:'closed',mysqlConcurrency:'pending'}],
  newFindings:[],protectedFileCount:protectedFiles.length,protectedFilesUnchanged:true,
  boundaries:{realMysql:false,realRepository:false,automaticCacheInvalidation:false,realHttp:false,browser:false,wholeProjectBuild:false,historicalFull73ProbeSuite:false,
    localSshLoopback:process.argv.includes('--historical'),baselineSignoffVerified:false,
    methodology:'Complete current source blocks, type erasure only; own quota grid plus historical tests with evidence-path-only redirects'},
  summary:{independentGroups:observations.length,passedIndependentGroups:observations.filter(x=>x.passed).length,closedAtDocumentLevel:4,newP1:0,newP2:0}};
fs.writeFileSync(path.join(__dirname,prefix+'.evidence.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({summary:evidence.summary,suites,protectedFileCount:evidence.protectedFileCount,sources},null,2));
