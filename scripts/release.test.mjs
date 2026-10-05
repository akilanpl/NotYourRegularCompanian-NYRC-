import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const script=path.resolve('scripts/release-version.mjs');
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'nyrc-release-test-'));for(const file of ['package.json','package-lock.json','src-tauri/tauri.conf.json','src-tauri/Cargo.toml','src-tauri/Cargo.lock']){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(file,path.join(root,file));}return root;}
for(const crlf of [false,true])test(`version check accepts locked fixture, CRLF=${crlf}`,()=>{const root=fixture();try{if(crlf)for(const file of ['src-tauri/Cargo.lock','src-tauri/Cargo.toml']){const p=path.join(root,file);fs.writeFileSync(p,fs.readFileSync(p,'utf8').replaceAll('\n','\r\n'));}assert.equal(spawnSync(process.execPath,[script],{cwd:root}).status,0);}finally{fs.rmSync(root,{recursive:true,force:true});}});
test('drift and wrong release tag fail closed',()=>{const root=fixture();try{assert.notEqual(spawnSync(process.execPath,[script],{cwd:root,env:{...process.env,GITHUB_REF_TYPE:'tag',GITHUB_REF_NAME:'v0.0.0'}}).status,0);const p=path.join(root,'src-tauri/tauri.conf.json');const config=JSON.parse(fs.readFileSync(p));config.version='0.0.0';fs.writeFileSync(p,JSON.stringify(config));assert.notEqual(spawnSync(process.execPath,[script],{cwd:root}).status,0);}finally{fs.rmSync(root,{recursive:true,force:true});}});
