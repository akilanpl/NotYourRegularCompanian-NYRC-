import fs from 'node:fs';import path from 'node:path';
const roots=['src','src-tauri/src','src-tauri/tauri.conf.json','package.json','README.md','CONTRIBUTING.md','SECURITY.md','PRIVACY.md','docs/ARCHITECTURE.md','docs/RELEASE.md','docs/PLATFORM-SUPPORT.md'];
function walk(p){if(!fs.existsSync(p))return[];return fs.statSync(p).isDirectory()?fs.readdirSync(p).flatMap(n=>walk(path.join(p,n))):[p];}
const failures=[];
for(const p of roots.flatMap(walk)){
 if(p==='src-tauri/src/legacy_migration.rs'||/\.(png|ico|icns|jpg)$/.test(p))continue;
 const text=fs.readFileSync(p,'utf8');
 if(/mochi|pet-mochi|com\.petmochi|MOCHI_HOME/i.test(text))failures.push(`${p}: donor identity`);
 if(/\/Users\/akilan\/|\/private\/tmp\/|\.codex\/attachments/.test(text))failures.push(`${p}: developer path`);
 if(/Companian/.test(text.replaceAll('NotYourRegularCompanian-NYRC-','')))failures.push(`${p}: product spelling`);
}
if(failures.length)throw Error(failures.join('\n'));console.log('NYRC active identity/path audit passed; isolated migration and legal attribution retained');
