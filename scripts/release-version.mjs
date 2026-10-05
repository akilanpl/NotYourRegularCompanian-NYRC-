import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const pkg=JSON.parse(read('package.json'));const version=pkg.version;
if(!/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(version))throw Error('Invalid release version');
const baseVersion=version.split('-')[0];const rc=version.match(/-rc\.(\d+)$/)?.[1];
if(rc&&(Number(rc)<1||Number(rc)>255))throw Error('Apple candidate build number must be 1..255');
const appleBuild=rc?`${baseVersion}fc${rc}`:baseVersion;
const plistPath='src-tauri/Info.release.plist';
const config=JSON.parse(read('src-tauri/tauri.conf.json'));const lock=JSON.parse(read('package-lock.json'));
let cargo=read('src-tauri/Cargo.toml');let cargoLock=read('src-tauri/Cargo.lock');
if(process.argv.includes('--sync')){
 config.bundle.macOS={...config.bundle.macOS,infoPlist:'Info.release.plist',bundleVersion:appleBuild};
 fs.writeFileSync(plistPath,`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${baseVersion}</string><key>NYRCReleaseVersion</key><string>${version}</string></dict></plist>\n`);
 config.version=version;lock.version=version;lock.packages[''].version=version;
 cargo=cargo.replace(/^(version = ")[^"]+("\s*)$/m,`$1${version}$2`);
 cargoLock=cargoLock.replace(/(\[\[package\]\]\nname = "nyrc"\nversion = ")[^"]+"/,`$1${version}"`);
 for(const [p,v]of[['src-tauri/tauri.conf.json',JSON.stringify(config,null,2)+'\n'],['package-lock.json',JSON.stringify(lock,null,2)+'\n'],['src-tauri/Cargo.toml',cargo],['src-tauri/Cargo.lock',cargoLock]])fs.writeFileSync(p,v);
}
const versions=[config.version,lock.version,lock.packages[''].version,cargo.match(/^version = "([^"]+)"/m)?.[1],cargoLock.match(/\[\[package\]\]\nname = "nyrc"\nversion = "([^"]+)"/)?.[1]];
if(versions.some(v=>v!==version))throw Error(`Version drift: ${version} / ${versions.join(' / ')}`);
const plist=read(plistPath);
if(config.bundle.macOS?.bundleVersion!==appleBuild||config.bundle.macOS?.infoPlist!=='Info.release.plist'||!plist.includes(`<key>CFBundleShortVersionString</key><string>${baseVersion}</string>`)||!plist.includes(`<key>NYRCReleaseVersion</key><string>${version}</string>`))throw Error('Apple bundle version drift');
const tag=process.env.GITHUB_REF_TYPE==='tag'?process.env.GITHUB_REF_NAME:null;
if(tag&&tag!==`v${version}`)throw Error('Release tag does not match package version');
console.log(`NYRC ${version}: version consistency verified`);
