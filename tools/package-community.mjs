// Local staging only: never tags, releases, pushes, deploys or contacts a service.
import {readFile,writeFile,mkdir,copyFile,access} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const destination=process.argv[2];
if(!destination)throw Error('Usage: npm run package:community -- /absolute/new/staging-directory');
const out=resolve(destination);
try{await access(out);throw Error('Destination already exists; choose a new directory.');}catch(e){if(e.code!=='ENOENT')throw e;}
const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
const versions=JSON.parse(await readFile(join(root,'versions.json'),'utf8'));
if(manifest.id!=='chatgpt-inbox-community'||!/^\d+\.\d+\.\d+$/.test(manifest.version)||pkg.version!==manifest.version||lock.version!==manifest.version||versions[manifest.version]!==manifest.minAppVersion)throw Error('Inconsistent identity or versions');
const bundle=await readFile(join(root,'main.js'),'utf8');
const imports=[...bundle.matchAll(/require\(["']([^"']+)["']\)/g)].map(m=>m[1]);
if(imports.some(id=>id!=='obsidian')||/\b(?:process|Buffer)\./.test(bundle))throw Error('Unexpected desktop dependency in mobile bundle');
const files=['.github/workflows/release.yml','CONTRIBUTING.md','eslint.config.mjs','README.md','LICENSE','PRIVACY.md','COMMUNITY.md','RELEASE-NOTES.md','AUDIT.md','manifest.json','versions.json','styles.css','package.json','package-lock.json','tsconfig.json','build.mjs','main.ts','core.ts','identity.ts','navigation.ts','source.ts','relay-client.ts','ui.ts','test.cjs','integration.cjs','source.test.cjs','identity.test.cjs','ui.test.cjs','relay/server.mjs','relay/storage.mjs','relay/relay.test.mjs','relay/postgres.test.mjs','relay/smoke.mjs','relay/README.md','relay/sql/001_relay_snapshot.sql','tools/package-community.mjs','tools/prepare-postgres-test.mjs','tools/community-ci.yml'];
for(const path of files)await access(join(root,path));
for(const path of files){const to=join(out,'source',path);await mkdir(dirname(to),{recursive:true});await copyFile(join(root,path),to);}
await writeFile(join(out,'source','.gitignore'),'node_modules/\nmain.js\n*.cjs\n!*.test.cjs\n!test.cjs\n!integration.cjs\n');
await mkdir(join(out,'source','.github','workflows'),{recursive:true});
await copyFile(join(root,'tools','community-ci.yml'),join(out,'source','.github','workflows','validate.yml'));
await mkdir(join(out,'release-assets'),{recursive:true});
const hashes=[];
for(const path of ['main.js','manifest.json','styles.css']){const bytes=await readFile(join(root,path));await writeFile(join(out,'release-assets',path),bytes);hashes.push(createHash('sha256').update(bytes).digest('hex')+'  '+path);}
await writeFile(join(out,'SHA256SUMS.txt'),hashes.join('\n')+'\n');
console.log(`Staged ${manifest.version} locally at ${out}; no publication performed.`);
