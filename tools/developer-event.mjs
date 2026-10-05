#!/usr/bin/env node
// No shell execution: writes one validated JSON event, atomically, to a local inbox.
import {mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';import {randomUUID} from 'node:crypto';
const [home,type,message='']=process.argv.slice(2);
const types=['task.started','task.completed','tests.passed','tests.failed','build.success','build.failed','agent.waiting','permission.required','agent.message'].map(t=>`developer.${t}`);
if(!home||!types.includes(type)||message.length>2000)throw Error('Usage: node tools/developer-event.mjs <NYRC home> <developer.event.type> [message]');
const dir=join(home,'developer-events');await mkdir(dir,{recursive:true,mode:0o700});const id=randomUUID();const file=join(dir,`${id}.json`);
await writeFile(`${file}.tmp`,JSON.stringify({id,type,timestamp:new Date().toISOString(),message}),{mode:0o600});await rename(`${file}.tmp`,file);
