import fs from 'node:fs';
const p=process.argv[2];if(!p)throw Error('Pass cargo-audit JSON report');const r=JSON.parse(fs.readFileSync(p,'utf8'));
if(r.vulnerabilities?.count)throw Error(`${r.vulnerabilities.count} Rust vulnerabilities`);
const unsound=r.warnings?.unsound??[];
for(const w of unsound)if(w.advisory.id!=='RUSTSEC-2024-0429'||w.package.name!=='glib'||w.package.version!=='0.18.5')throw Error(`Unreviewed soundness warning: ${w.advisory.id}`);
console.log('Rust vulnerability count: 0');
for(const [kind,items]of Object.entries(r.warnings??{}))for(const w of items)console.log(`${kind}: ${w.advisory.id} ${w.package.name} ${w.package.version}`);
if(unsound.length)console.log('glib exception rationale and exact chain: docs/DEPENDENCY-SECURITY.md. No general advisory suppression.');

for(const folder of ['src-tauri/src','src']){
 const scan=p=>{for(const entry of fs.readdirSync(p,{withFileTypes:true})){const file=`${p}/${entry.name}`;if(entry.isDirectory())scan(file);else if(/\.(rs|ts|svelte)$/.test(file)&&/\b(VariantStrIter|array_iter_str)\b/.test(fs.readFileSync(file,'utf8')))throw Error(`glib exception requires re-review: ${file}`);}};scan(folder);
}
