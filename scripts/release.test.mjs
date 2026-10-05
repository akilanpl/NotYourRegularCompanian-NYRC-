import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const script=path.resolve('scripts/release-version.mjs');
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'nyrc-release-test-'));for(const file of ['package.json','package-lock.json','src-tauri/tauri.conf.json','src-tauri/Cargo.toml','src-tauri/Cargo.lock','src-tauri/Info.release.plist']){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(file,path.join(root,file));}return root;}
for(const crlf of [false,true])test(`version check accepts locked fixture, CRLF=${crlf}`,()=>{const root=fixture();try{if(crlf)for(const file of ['src-tauri/Cargo.lock','src-tauri/Cargo.toml']){const p=path.join(root,file);fs.writeFileSync(p,fs.readFileSync(p,'utf8').replaceAll('\n','\r\n'));}assert.equal(spawnSync(process.execPath,[script],{cwd:root}).status,0);}finally{fs.rmSync(root,{recursive:true,force:true});}});
test('drift and wrong release tag fail closed',()=>{const root=fixture();try{assert.notEqual(spawnSync(process.execPath,[script],{cwd:root,env:{...process.env,GITHUB_REF_TYPE:'tag',GITHUB_REF_NAME:'v0.0.0'}}).status,0);const p=path.join(root,'src-tauri/tauri.conf.json');const config=JSON.parse(fs.readFileSync(p));config.version='0.0.0';fs.writeFileSync(p,JSON.stringify(config));assert.notEqual(spawnSync(process.execPath,[script],{cwd:root}).status,0);}finally{fs.rmSync(root,{recursive:true,force:true});}});

import {verifyArchitecture} from './release-architecture.mjs';
test('artifact architecture labels follow executable headers',()=>{
 const arm=Buffer.alloc(64);arm.writeUInt32LE(0xfeedfacf,0);arm.writeUInt32LE(0x0100000c,4);
 assert.equal(verifyArchitecture(arm,'aarch64-apple-darwin'),'aarch64-apple-darwin');
 assert.throws(()=>verifyArchitecture(arm,'x86_64-apple-darwin'),/mismatch/);
 const elf=Buffer.alloc(64);Buffer.from([0x7f,0x45,0x4c,0x46,2,1]).copy(elf);elf.writeUInt16LE(62,18);assert.equal(verifyArchitecture(elf,'x86_64-unknown-linux-gnu'),'x86_64-unknown-linux-gnu');
 const pe=Buffer.alloc(96);pe.writeUInt16LE(0x5a4d);pe.writeUInt32LE(64,0x3c);pe.writeUInt32LE(0x4550,64);pe.writeUInt16LE(0x8664,68);assert.equal(verifyArchitecture(pe,'x86_64-pc-windows-msvc'),'x86_64-pc-windows-msvc');
 assert.throws(()=>verifyArchitecture(Buffer.alloc(2),'aarch64-apple-darwin'));
});

test('derived Apple build metadata cannot drift',()=>{const root=fixture();try{const p=path.join(root,'src-tauri/tauri.conf.json');const config=JSON.parse(fs.readFileSync(p));config.bundle.macOS.bundleVersion='1.0.0fc2';fs.writeFileSync(p,JSON.stringify(config));assert.notEqual(spawnSync(process.execPath,[script],{cwd:root}).status,0);}finally{fs.rmSync(root,{recursive:true,force:true});}});
