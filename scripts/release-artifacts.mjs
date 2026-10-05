import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const [target,signing='unsigned']=process.argv.slice(2);
const platforms={'aarch64-apple-darwin':['macOS','arm64'],'x86_64-apple-darwin':['macOS','x64'],'x86_64-pc-windows-msvc':['Windows','x64'],'x86_64-unknown-linux-gnu':['Linux','x64']};
if(!platforms[target]||!['unsigned','signed'].includes(signing))throw Error('Pass supported target triple and unsigned|signed');
const version=JSON.parse(fs.readFileSync('package.json')).version;
const [platform,arch]=platforms[target];
const prefix=`NYRC-${version}-${platform}-${arch}-${signing}`;
const root=`src-tauri/target/${target}/release/bundle`;
const out='release-artifacts';fs.mkdirSync(out,{recursive:true});
const copied=[];
if(platform==='macOS'){
 const source=path.join(root,'macos','NYRC.app');
 const dest=path.join(out,`${prefix}.zip`);
 const p=spawnSync('ditto',['-c','-k','--sequesterRsrc','--keepParent',source,dest],{stdio:'inherit'});if(p.status!==0)throw Error('App archive failed');copied.push(dest);
}
for(const [folder,extension]of(platform==='macOS'?[['dmg','.dmg']]:platform==='Windows'?[['nsis','.exe']]:[['deb','.deb'],['appimage','.AppImage']])){
 const dir=path.join(root,folder);if(!fs.existsSync(dir))continue;
 for(const file of fs.readdirSync(dir).filter(x=>x.endsWith(extension))){const dest=path.join(out,`${prefix}${extension}`);if(fs.existsSync(dest))throw Error('Duplicate artifact extension');fs.copyFileSync(path.join(dir,file),dest);copied.push(dest);}
}
if(!copied.length)throw Error('No packaged artifacts');
const sums=copied.map(file=>`${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${path.basename(file)}`);
fs.writeFileSync(path.join(out,`${prefix}-SHA256SUMS.txt`),sums.join('\n')+'\n');
const git=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});if(git.status!==0)throw Error('Cannot determine provenance');
fs.writeFileSync(path.join(out,`${prefix}-metadata.json`),JSON.stringify({product:'NYRC',version,target,platform,architecture:arch,signing,commit:git.stdout.trim(),artifacts:copied.map(path.basename),note:signing==='unsigned'?'Not trusted publisher signed; macOS may be ad hoc signed.':'Signing requested; consult signing verification evidence.'},null,2)+'\n');
console.log(sums.join('\n'));
