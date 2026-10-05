import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const pkg=JSON.parse(read('package.json'));const version=pkg.version;
if(!/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(version))throw Error('Invalid release version');
const config=JSON.parse(read('src-tauri/tauri.conf.json'));const lock=JSON.parse(read('package-lock.json'));
let cargo=read('src-tauri/Cargo.toml');let cargoLock=read('src-tauri/Cargo.lock');
if(process.argv.includes('--sync')){
 config.version=version;lock.version=version;lock.packages[''].version=version;
 cargo=cargo.replace(/^(version = ")[^"]+("\s*)$/m,`$1${version}$2`);
 cargoLock=cargoLock.replace(/(\[\[package\]\]\nname = "nyrc"\nversion = ")[^"]+"/,`$1${version}"`);
 for(const [p,v]of[['src-tauri/tauri.conf.json',JSON.stringify(config,null,2)+'\n'],['package-lock.json',JSON.stringify(lock,null,2)+'\n'],['src-tauri/Cargo.toml',cargo],['src-tauri/Cargo.lock',cargoLock]])fs.writeFileSync(p,v);
}
const versions=[config.version,lock.version,lock.packages[''].version,cargo.match(/^version = "([^"]+)"/m)?.[1],cargoLock.match(/\[\[package\]\]\nname = "nyrc"\nversion = "([^"]+)"/)?.[1]];
if(versions.some(v=>v!==version))throw Error(`Version drift: ${version} / ${versions.join(' / ')}`);
const tag=process.env.GITHUB_REF_TYPE==='tag'?process.env.GITHUB_REF_NAME:null;
if(tag&&tag!==`v${version}`)throw Error('Release tag does not match package version');
console.log(`NYRC ${version}: version consistency verified`);
