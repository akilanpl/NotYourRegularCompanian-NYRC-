import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
const root=process.cwd();
const flags=[...(process.env.CARGO_ENCODED_RUSTFLAGS?.split('\x1f')??[])].filter(Boolean);
for(const [from,to] of [[root,'nyrc-source'],[process.env.CARGO_HOME??path.join(os.homedir(),'.cargo'),'cargo-registry'],[os.homedir(),'build-home']]) flags.push(`--remap-path-prefix=${from}=${to}`);
const result=spawnSync(process.execPath,['node_modules/@tauri-apps/cli/tauri.js','build',...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,CARGO_ENCODED_RUSTFLAGS:flags.join('\x1f')}});
if(result.error) throw result.error;
process.exit(result.status??1);
