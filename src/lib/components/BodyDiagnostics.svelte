<script lang="ts">
 import {onMount} from "svelte";
 import {bodyCore} from "../body/session";
 import {VirtualBodyAdapter} from "../body/adapters";
 import {emit,invoke,listen} from "../bridge/tauri";
 import {validateReaction,type Reaction} from "../character";
 import type {BodyStatus} from "../body/core";
 import type {InputType} from "../body/protocol";
 const virtual=new VirtualBodyAdapter();
 let remoteStatuses=$state<BodyStatus[]>([]);
 let diagnostics=$state<unknown>(null),statuses=$state(bodyCore.diagnostics()),commands=$state(virtual.commands),message=$state(""),transport=$state<{port:number;token:string}|null>(null);
 async function refresh(){try{diagnostics=await invoke("get_diagnostics");}catch{diagnostics={platform:"browser preview",storage:"Native backend required"};}statuses=bodyCore.diagnostics();}
 onMount(()=>{
  void refresh();let disposed=false;const stops:(()=>void)[]=[];
  const off=bodyCore.subscribe(()=>{statuses=bodyCore.diagnostics();commands=virtual.commands;});
  listen<BodyStatus[]>("body:diagnostics",s=>{remoteStatuses=s;}).then(off=>{if(disposed)off();else stops.push(off);void emit("body:diagnostics-request");});
  listen<Reaction>("body:reaction",r=>{if(validateReaction(r))bodyCore.react(r);}).then(off=>{if(disposed)off();else stops.push(off);});
  return ()=>{disposed=true;off();stops.forEach(f=>f());void bodyCore.disconnect(virtual.bodyId);};
 });
 async function connect(){await bodyCore.connect(virtual);message="Virtual body connected";}
 async function disconnect(){await bodyCore.disconnect(virtual.bodyId);message="Virtual body disconnected; assistant remains active";}
 function input(type:InputType,payload:Record<string,unknown>={}){if(!virtual.simulate(type,payload)){message="Input rejected: connect the body first";return;}void emit("body:virtual-input",{version:1,type,bodyId:"desktop",timestamp:new Date().toISOString(),payload});message=`Sent ${type}`;}
 async function output(type:"brightness"|"haptic"|"text"|"sound"|"status_indicator"){await bodyCore.send({version:1,bodyId:"virtual",type,payload:type==="brightness"?{level:.5}:type==="haptic"?{intensity:.25,durationMs:100}:type==="text"?{text:"NYRC body test"}:type==="sound"?{id:"confirm"}:{state:"connected"}});}
 async function startTransport(){try{transport=await invoke("start_body_transport");message="Loopback transport started. Pairing token is shown only in this session.";}catch{message="Could not start local transport";}}
 async function stopTransport(){await invoke("stop_body_transport");transport=null;message="Local transport stopped";}
</script>
<details>
 <summary>Platform &amp; body diagnostics</summary>
 <button onclick={refresh}>Refresh diagnostics</button>
 <pre>{JSON.stringify(diagnostics,null,2)}</pre>
 <h3>Virtual body</h3>
 <button onclick={connect}>Connect / reconnect virtual body</button><button onclick={disconnect}>Disconnect virtual body</button>
 <div class="controls">
 {#each ["touch","hold","double_tap","shake","pickup","put_down","ready","sleep","wake"] as type}<button onclick={()=>input(type as InputType)}>{type}</button>{/each}
 <button onclick={()=>{for(let i=0;i<4;i++)input("touch");}}>Repeated taps</button>
 <button onclick={()=>input("button",{button:"primary"})}>Button</button>
 <button onclick={()=>input("battery",{percent:10,charging:false})}>Low battery</button>
 <button onclick={()=>input("connection",{online:false})}>Offline status</button>
 <button onclick={()=>{message=bodyCore.input({version:9,type:"execute",bodyId:"virtual",payload:{shell:"invalid"}})?"Unexpected acceptance":"Malformed input rejected";}}>Reject malformed event</button>
 {#each ["brightness","haptic","text","sound","status_indicator"] as type}<button onclick={()=>output(type as "brightness"|"haptic"|"text"|"sound"|"status_indicator")}>Test {type}</button>{/each}
 </div>
 <p role="status">{message}</p>
 <pre aria-label="Connected body diagnostics">{JSON.stringify([...remoteStatuses,...statuses],null,2)}</pre>
 <pre aria-label="Virtual body outputs">{JSON.stringify(commands.slice(-12),null,2)}</pre>
 <h3>Local development transport</h3>
 <button onclick={startTransport}>Start loopback body transport</button><button onclick={stopTransport} disabled={!transport}>Stop transport</button>
 {#if transport}<p>127.0.0.1:{transport.port}</p><p>Session pairing token: <code>{transport.token}</code></p>{/if}
</details>
<style>pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;font-size:11px}.controls{display:flex;flex-wrap:wrap;gap:4px}button{margin:3px}code{overflow-wrap:anywhere}</style>
