#!/usr/bin/env node
// Tiny host-side ESP32 protocol fixture. Token arrives through stdin, never argv/logs.
import {connect} from 'node:net';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
const port=Number(process.argv[2]);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Usage: node tools/body-client.mjs <port>; supply session token on stdin');
const input=createInterface({input:process.stdin,terminal:false});
const token=await new Promise(resolve=>input.once('line',resolve));input.close();
if(!/^[a-f0-9]{64}$/.test(token))throw Error('Invalid session token');
let attempt=0,socket,heartbeat,buffer='';
const bodyId='esp32-fixture';
const send=frame=>socket?.write(JSON.stringify(frame)+'\n');
function open(){
 buffer='';socket=connect({host:'127.0.0.1',port});
 socket.on('connect',()=>send({type:'hello',version:1,messageId:randomUUID(),bodyId,token,capabilities:{inputs:['touch','shake','battery','ready'],outputs:['expression','animation','text','sound','brightness','status_indicator','sleep','wake']}}));
 socket.on('data',bytes=>{
  buffer+=bytes.toString('utf8');if(Buffer.byteLength(buffer)>8192){socket.destroy();return;}
  let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(Buffer.byteLength(line)>4096){socket.destroy();return;}
   let frame;try{frame=JSON.parse(line);}catch{socket.destroy();return;}
   if(frame.type==='welcome'){
    attempt=0;console.info('Paired local body fixture');
    heartbeat=setInterval(()=>send({type:'heartbeat',version:1,messageId:randomUUID()}),30000);
    ['ready','touch','shake','battery'].forEach((type,i)=>setTimeout(()=>send({type:'input',version:1,messageId:randomUUID(),event:{version:1,type,bodyId,timestamp:new Date().toISOString(),payload:type==='battery'?{percent:12,charging:false}:{}}}),i*300));
   }else if(frame.type==='command'){
    console.info('Body output:',frame.command?.type,JSON.stringify(frame.command?.payload));
    send({type:'ack',version:1,messageId:frame.messageId});
   }else if(frame.type==='error'){console.warn('Protocol error:',frame.code);socket.destroy();}
  }
 });
 socket.on('error',()=>{});
 socket.on('close',()=>{clearInterval(heartbeat);if(attempt<5)setTimeout(open,Math.min(30000,1000*2**attempt++));else console.warn('Reconnect limit reached; restart fixture with a fresh session token');});
}
open();
