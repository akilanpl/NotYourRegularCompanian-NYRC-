<script lang="ts">
 import type { AssistantRuntime } from '../assistant/runtime';
 import { taskMessage } from '../assistant/runtime';
 import type { Entities, RouteSource } from '../assistant/router';
 import type { CompanionTask } from '../tasks/task';
 let {runtime,entities,onResult,onThinking}:{runtime:AssistantRuntime;entities:()=>Entities;onResult:(task?:CompanionTask)=>void;onThinking:()=>void}=$props();
 let input=$state('');let response=$state('Useful when you need me.');let request=$state('');let busy=$state(false);let source=$state<RouteSource>('local');let pending=$state<CompanionTask[]>([]);let result=$state<unknown>(null);
 let binary=$derived(result && typeof result==='object' && 'metadata' in result && (result.metadata as {encoding?:string})?.encoding==='base64');
 let content=$derived(!binary && result && typeof result==='object' && 'content' in result && typeof result.content==='string' ? result.content : null);
 $effect(() => {
  pending=runtime.tasks.list().filter(t=>t.status==='permission_required');
  return runtime.tasks.subscribe(()=>{pending=runtime.tasks.list().filter(t=>t.status==='permission_required');});
 });
 async function submit(){if(busy||!input.trim())return;const value=input;input='';request=value;busy=true;onThinking();try{const r=await runtime.submit(value,entities());response=r.message;source=r.route.source;result=r.task?.result;onResult(r.task);}catch{response='That did not complete. Please try again.';}finally{busy=false;}}
 async function permission(t:CompanionTask,allow:boolean){busy=true;try{const result=await runtime.permission(t.id,allow);response=taskMessage(result);onResult(result);}finally{busy=false;}}
</script>
<section class="assistant-input" aria-label="NYRC assistant">
 <form onsubmit={e=>{e.preventDefault();void submit();}}>
  <label for="nyrc-command">Ask NYRC</label>
  <div><input id="nyrc-command" bind:value={input} maxlength="2000" placeholder="timer 25 minutes" disabled={busy}/><button disabled={busy||!input.trim()} type="submit">{busy?'Working…':'Go'}</button></div>
 </form>
 {#if request}<p class="request">{request}</p>{/if}
 <p class="response" role="status" aria-live="polite">{response}</p>
 {#if binary && result && typeof result==='object' && 'id' in result}<button onclick={async()=>{const task=await runtime.execute({id:'pocket.export_file',payload:{id:(result as {id:string}).id},permission:'none'},'Export Pocket file');response=taskMessage(task);onResult(task);}}>Export file to NYRC exports</button>{/if}
 {#if content !== null}<label for="pocket-content">Retrieved content</label><textarea id="pocket-content" rows="5" readonly value={content}></textarea><button onclick={async()=>{const task=await runtime.execute({id:'clipboard.write',payload:{content},permission:'none'},'Copy retrieved content');response=taskMessage(task);onResult(task);}}>Copy content</button>{/if}
 {#if import.meta.env.DEV}<small>Route: {source}</small>{/if}
 {#each pending as task(task.id)}<div class="permission" role="group" aria-label="Permission request"><p>{task.permissionRequest?.prompt}</p><small>{task.action.id} · {JSON.stringify(task.action.payload)}</small><div><button onclick={()=>permission(task,true)} disabled={busy}>Allow once</button><button onclick={()=>permission(task,false)} disabled={busy}>Deny</button></div></div>{/each}
</section>
<style>
 .assistant-input{padding:12px;border:1px solid #a5a0b0;border-radius:12px;margin-bottom:12px;background:#f5f2f8;color:#24202d}form>div,.permission>div{display:flex;gap:6px;margin-top:6px}input{min-width:0;flex:1;padding:8px}button{padding:6px 10px}label{font-weight:600}.request{font-size:11px;opacity:.7}.response{white-space:pre-wrap;max-height:180px;overflow:auto;font-size:13px}textarea{width:100%;box-sizing:border-box;resize:vertical}.permission{border-top:1px solid #ccc;padding-top:8px}small{overflow-wrap:anywhere}
</style>
