'use strict';
// Snapshot audit: documents are read-only. Positive findings intentionally assert current contradictions.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const names = ['ARCHITECTURE_SPEC', 'BACKEND_ARCHITECTURE_SPEC', 'FRONTEND_ARCHITECTURE_SPEC', 'API_CONTRACT_SPEC', 'DATABASE_DESIGN_SPEC'];
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex');
const sourcePaths = [...names.map(n => 'docs/' + n + '.md'), 'docs/sql/001_metadata_schema.sql'];
const sources = sourcePaths.map(p => ({path:p, sha256:hash(p), bytes:fs.statSync(path.join(root,p)).size, lines:read(p).split(/\r?\n/).length}));
const [arch, be, fe, api, db] = names.map(n => read('docs/' + n + '.md'));
const ddl = read('docs/sql/001_metadata_schema.sql');
const observations = [];
function observe(id, description, fn) { observations.push({id, description, ...fn()}); }
function section(text, heading) {
  const start=text.indexOf(heading); assert(start>=0, heading);
  const level=heading.match(/^#+/)[0].length;
  const tail=text.slice(start+heading.length);
  const match=new RegExp('\\n#{1,'+level+'} ').exec(tail);
  return text.slice(start,match?start+heading.length+match.index:text.length);
}
function tables(text) {
  return Object.fromEntries([...text.matchAll(/CREATE TABLE `([^`]+)`\s*\(([\s\S]*?)\) ENGINE=/g)].map(m=>[m[1],m[2]]));
}
function columns(body) {return Object.fromEntries([...body.matchAll(/^\s*`([^`]+)`\s+(.+)$/gm)].map(m=>[m[1],m[2].replace(/ COMMENT '[^']*'/,'').replace(/,$/,'')]));}
function interfaceCode(text,name){const m=text.match(new RegExp('export interface '+name+' \\{[\\s\\S]*?\\n\\}'));assert(m);return m[0];}
function compile(code){
  const filename=path.join(root,'__review_virtual__.ts');
  const opts={strict:true,noEmit:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,types:[]};
  const host=ts.createCompilerHost(opts),old=host.getSourceFile.bind(host);
  host.getSourceFile=(f,v,...rest)=>path.resolve(f)===filename?ts.createSourceFile(f,code,v,true):old(f,v,...rest);
  const p=ts.createProgram([filename],opts,host);
  return ts.getPreEmitDiagnostics(p).filter(d=>d.file && path.resolve(d.file.fileName)===filename).map(d=>({code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,'\n')}));
}
function requestFields(text){
  const sub=text.split('- **请求体 JSON Schema**：')[1]; assert(sub);
  const rows=sub.split('\n').filter(l=>/^\s*\| `/.test(l));
  return rows.map(l=>{const cells=l.split('|').map(s=>s.trim());return {name:cells[1].replaceAll('`',''),required:cells[3]==='是'};});
}
function matrixRow(text,route){const rows=text.split('\n').filter(l=>l.startsWith('|')&&l.includes('`'+route+'`'));assert(rows.length);return rows[0];}
function matrixRoutes(text) {
  const result=[];
  for(const line of text.split('\n')){
    if(!line.startsWith('|'))continue;
    const match=line.match(/`(\/api\/v1\/[^`]+)`\s*\|\s*`([A-Z/]+)`/);
    if(match)for(const verb of match[2].split('/'))result.push(verb+' '+match[1]);
  }
  return [...new Set(result)].sort();
}
observe('RD-01','API update CAS and lifetime counter diverge',()=>{
  const update=section(api,'#### 6.7.4');
  const sqlBlocks=[...update.matchAll(/```sql\n([\s\S]*?)```/g)].map(m=>m[1]);
  assert.equal(sqlBlocks.length,2);
  assert(sqlBlocks[0].includes('last_revision = last_revision + 1'));
  assert(sqlBlocks[1].includes('revision = revision + 1'));
  assert(!sqlBlocks[1].includes('sys_rate_limit_revisions'));
  assert(sqlBlocks[1].includes('user_quota_qpm'));
  assert(!Object.hasOwn(columns(tables(ddl).sys_rate_limits),'user_quota_qpm'));
  function model(sync){let counter=0,revision=null;const steps=[];
    counter++;revision=counter;steps.push({op:'create',counter,revision});
    if(sync)counter++;revision++;steps.push({op:'update',counter,revision});
    const stale=revision;revision=null;steps.push({op:'delete',counter,revision});
    counter++;revision=counter;steps.push({op:'recreate',counter,revision});
    return {steps,staleRevision:stale,staleCasAccepted:revision===stale};}
  const current=model(false), corrected=model(true);
  assert(current.staleCasAccepted);assert(!corrected.staleCasAccepted);
  return {findingConfirmed:true,apiSql:sqlBlocks,currentModel:current,correctedControl:corrected,physicalColumn:'qpm_limit',boundary:'SQL-guided serialized model; no database concurrency claim'};
});
observe('RD-02','UTC DATETIME is interpreted with the backend +08:00 driver option',()=>{
  const pool=section(be,'### 4.2');
  const timezone=pool.match(/timezone:\s*'([^']+)'/)[1];assert.equal(timezone,'+08:00');
  assert(db.includes("timezone: 'Z'"));assert(ddl.includes("SET SESSION time_zone = '+00:00'"));
  const mysqlRoot=path.dirname(require.resolve('mysql2/package.json'));
  const Packet=require(path.join(mysqlRoot,'lib/packets/packet.js'));
  function decode(tz){const value=Buffer.from('2026-11-12 08:00:00.123');const raw=Buffer.concat([Buffer.alloc(4),Buffer.from([value.length]),value]);const p=new Packet(0,raw,0,raw.length);return p.parseDateTime(tz).toISOString();}
  const actual=decode(timezone),expected=decode('Z');
  assert.equal(actual,'2026-11-12T00:00:00.123Z');assert.equal(expected,'2026-11-12T08:00:00.123Z');
  return {findingConfirmed:true,driverVersion:require(path.join(mysqlRoot,'package.json')).version,timezone,storedUtc:'2026-11-12 08:00:00.123',actual,expected,deltaHours:(Date.parse(actual)-Date.parse(expected))/3600000,boundary:'Real mysql2 packet parser, fabricated protocol buffer; no MySQL server'};
});
observe('RD-03','Backend full DDL and standalone reference DDL are different schemas',()=>{
  const old=tables(section(be,'### 4.1')),current=tables(ddl);assert.equal(Object.keys(old).length,13);assert.equal(Object.keys(current).length,14);
  const differences=[];
  for(const [table,body]of Object.entries(current)){
    if(!old[table]){differences.push({table,missingTable:true});continue;}
    const a=columns(old[table]),b=columns(body);
    const added=Object.keys(b).filter(c=>!Object.hasOwn(a,c));
    const changed=Object.keys(b).filter(c=>Object.hasOwn(a,c)&&a[c]!==b[c]).map(c=>({column:c,backend:a[c],reference:b[c]}));
    if(added.length||changed.length)differences.push({table,added,changed});
  }
  assert(differences.find(d=>d.table==='sys_rate_limits').added.includes('revision'));
  assert(old.sys_user_roles.includes('REFERENCES `sys_roles` (`id`) ON DELETE CASCADE'));
  assert(current.sys_user_roles.includes('REFERENCES `sys_roles` (`id`) ON DELETE RESTRICT'));
  assert(columns(old.sys_audit_logs).profile_name.includes('VARCHAR(64)'));
  assert(columns(current.sys_audit_logs).profile_name.includes('VARCHAR(128)'));
  return {findingConfirmed:true,backendTables:13,referenceTables:14,differences,foreignKeyDifference:'sys_user_roles.role_id: CASCADE vs RESTRICT',boundary:'Textual SQL structure comparison, not MySQL execution'};
});
observe('RD-04','API Profile GET fixture cannot satisfy frontend ProfileDTO',()=>{
  const dto=interfaceCode(fe,'ProfileDTO');
  const get=section(api,'#### 6.5.1');const fixture=JSON.parse(get.match(/```json\n([\s\S]*?)```/)[1])[0];
  assert.equal(fixture.username,'mcp_readonly_user');assert(!Object.hasOwn(fixture,'user'));
  const compileFixture=(shape,obj)=>compile(shape+'\nconst response = '+JSON.stringify(obj)+';\nconst profile: ProfileDTO = response;');
  const diagnostics=compileFixture(dto,fixture);assert(diagnostics.some(d=>d.message.includes("'user'")));
  const fixed=compileFixture(dto.replace('  user: string;','  username: string;'),fixture);assert.deepEqual(fixed,[]);
  return {findingConfirmed:true,typescriptVersion:ts.version,diagnostics,correctedDtoControl:fixed,boundary:'Actual strict TypeScript compilation of extracted interface and unchanged API fixture'};
});
observe('RD-05','Request mapping tables omit required fields or use a different filter key',()=>{
  const globalFields=requestFields(section(api,'#### 6.7.2'));
  const row=matrixRow(section(fe,'### 8.1'),'/api/v1/rate-limits/global');
  const payload=row.match(/PUT:\s*`?\{([^}]+)\}/)[1].split(',').map(s=>s.trim().replace(/\?$/,''));
  const missing=globalFields.filter(f=>f.required&&!payload.includes(f.name)).map(f=>f.name);assert.deepEqual(missing,['burstCapacity']);
  const exportFields=requestFields(section(api,'#### 6.8.3')).map(f=>f.name);
  const rows=[['frontend',section(fe,'### 8.1')],['backend',section(be,'### 11.1')]].map(([name,text])=>{const row=matrixRow(text,'/api/v1/audits/export');assert(row.includes('profileId'));return {name,row,unknownFilter:'profileId',acceptedFilter:exportFields.find(f=>f==='profile_id')};});
  assert(!exportFields.includes('profileId'));
  const sshRow=matrixRow(fe,'/api/v1/profiles/test-ssh');assert(!sshRow.includes('hostFingerprintSha256'));
  return {findingConfirmed:true,globalPut:{frontendFields:payload,missingRequired:missing},auditExport:rows,sshFingerprintMissingFromFrontendRequestMatrix:true,boundary:'Contract-table comparison; no HTTP execution'};
});
observe('RD-06','Canonical endpoints have no corresponding detailed-design matrix entry',()=>{
  const canonical=[...api.matchAll(/\*\*接口路径\*\*：`([A-Z]+ \/api\/v1\/[^`]+)`/g)].map(m=>m[1]).sort();
  const actual={frontend:matrixRoutes(section(fe,'### 8.1')),backend:matrixRoutes(section(be,'### 11.1'))};
  const missing=Object.fromEntries(Object.entries(actual).map(([name,list])=>[name,canonical.filter(r=>!list.includes(r))]));
  for(const name of ['frontend','backend']){
    assert(missing[name].includes('POST /api/v1/users/:id/reset-password'));
    assert(missing[name].includes('DELETE /api/v1/rate-limits/users/:id'));
  }
  assert(!fe.includes('/api/v1/users/:id/reset-password'));assert(!be.includes('/api/v1/users/:id/reset-password'));
  return {findingConfirmed:true,canonicalCount:canonical.length,mappedCounts:Object.fromEntries(Object.entries(actual).map(([n,v])=>[n,v.length])),missing,boundary:'Exact method + path matrix coverage; absence is a design traceability gap, not a running-server 404'};
});
observe('RD-07','The new stable super-admin lock point is absent from the backend transaction example',()=>{
  const tx=section(be,'#### 4.4.1');const dbTx=section(db,'### 7.4');
  assert(tx.includes('INNER JOIN sys_user_roles'));assert(tx.includes("WHERE r.role_name = 'SUPER_ADMIN' AND u.status = 'ACTIVE'"));
  assert(!tx.includes("SELECT id FROM sys_roles WHERE role_name = 'SUPER_ADMIN' FOR UPDATE"));
  assert(dbTx.includes("SELECT id FROM sys_roles WHERE role_name = 'SUPER_ADMIN' FOR UPDATE"));
  return {findingConfirmed:true,backend:'Locks a mutable joined active-super-admin result set',database:'First locks the permanent SUPER_ADMIN role row and applies one lock order',boundary:'Different mandated algorithms; no assertion that the old join necessarily allows write-skew under actual MySQL locking'};
});
observe('RD-08','Unfrozen defaults and scope are explicitly left for signoff',()=>{
  assert(be.includes("('GLOBAL', 0, 60, 15, 3, 30, 1)"));assert(db.includes('新建库全局种子和 USER 缺省取 10'));
  assert(db.includes('未签署前不冻结联调基线'));assert(fe.includes('通配符支持待后端确认'));assert(db.includes('v1.0 库 ACL 只接受精确库名'));
  return {findingConfirmed:true,globalBurst:{backendSeed:15,databaseNewInstall:10},databaseAcl:{frontend:'pending backend confirmation',database:'exact names only'},signoff:'DB-R1-02 product/interface signoff not evidenced by current repository',boundary:'Document statements; does not assert no approval exists outside this workspace'};
});
observe('RD-09','Bootstrap recovery policy differs from the database initialization policy',()=>{
  const bootstrap=section(be,'### 5.1');const init=section(db,'### 11.1');
  assert(bootstrap.includes("WHERE r.role_name = 'SUPER_ADMIN' AND u.status = 'ACTIVE'"));
  assert(bootstrap.includes('if (existingAdmins.length > 0) return;'));
  assert(bootstrap.includes("VALUES ('admin', ?, 'ACTIVE', 1, 1)"));
  assert(init.includes('只有首次空库初始化允许创建'));
  assert(init.includes('不每次启动自动补一个管理员'));
  return {findingConfirmed:true,backend:'Creates admin whenever the active-super-admin SELECT returns empty',database:'Only first empty-database initialization may create admin; later absence requires alarm/manual recovery',trigger:'Nonempty database, zero active super-admins, no existing username admin',boundary:'Control-flow inspection only; no actual account created'};
});
let history=null;
const historyIndex=process.argv.indexOf('--history');
if(historyIndex>=0){
  const file=path.resolve(process.argv[historyIndex+1]);const historical=JSON.parse(fs.readFileSync(file,'utf8'));
  for(const s of sources)assert.equal(historical.sources.find(v=>v.path===s.path).sha256,s.sha256,'History evaluated a different source: '+s.path);
  history={runner:file,main:historical,children:historical.suites.map(s=>({name:s.script,evidence:JSON.parse(fs.readFileSync(path.join(path.dirname(file),s.evidenceFile),'utf8'))}))};
}
for(const s of sources)assert.equal(hash(s.path),s.sha256,'Source modified during review');
const result={review:'five-document-development-readiness',date:'2026-11-12',timezone:'Asia/Shanghai',runtime:process.version,sources,observations,history,
  summary:{observationGroups:observations.length,confirmedGroups:observations.filter(o=>o.findingConfirmed).length,meaning:'Confirmed mismatches/decision gaps, NOT passing product tests'},
  boundaries:{realMysql:false,realHttp:false,browserE2E:false,wholeProjectBuild:false,sourceDocumentsModified:false,networkNeededByThisScript:false}};
const out=path.join(__dirname,'comprehensive-design-readiness-20261112.evidence.json');
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({summary:result.summary,profileDiagnostics:observations.find(o=>o.id==='RD-04').diagnostics,routeCoverage:observations.find(o=>o.id==='RD-06'),history:history?.main.summary,output:out},null,2));
