import { describe, expect, it } from "vitest";
import {
  actionFailure,
  actionSuccess,
  MockActionExecutor,
  reactionForTaskStatus,
  TaskManager,
  type CompanionTask,
} from "./index";

function task(manager: TaskManager, permission: "none" | "confirm" | "sensitive" = "none") {
  return manager.create({
    type: "example",
    origin: "user",
    title: "Example action",
    action: { id: "example.run", payload: { value: 1 }, permission },
  });
}

describe("TaskManager", () => {
  it("creates queued tasks and emits their semantic reaction", () => {
    const manager = new TaskManager(() => new Date("2026-10-05T00:00:00.000Z"));
    const changes: Array<{ task: CompanionTask; reaction: string }> = [];
    manager.subscribe(({ task: current, reaction }) =>
      changes.push({ task: current, reaction: reaction.expression }),
    );
    const created = task(manager);
    expect(created).toMatchObject({
      id: "task-1",
      status: "queued",
      origin: "user",
      permissionGranted: true,
      createdAt: "2026-10-05T00:00:00.000Z",
    });
    expect(changes[0].reaction).toBe("waiting");
    expect(manager.get(created.id)).toBe(created);
  });

  it("rejects illegal and terminal status transitions", () => {
    const manager = new TaskManager();
    const created = task(manager);
    expect(() => manager.complete(created.id)).toThrow(
      "Invalid task status transition",
    );
    manager.cancel(created.id);
    expect(() => manager.updateStatus(created.id, "running")).toThrow(
      "Invalid task status transition",
    );
  });

  it("executes supported actions and records successful results", async () => {
    const manager = new TaskManager();
    const created = task(manager);
    const executor = new MockActionExecutor(["example.run"], actionSuccess({ done: true }));
    const completed = await manager.execute(created.id, executor);
    expect(completed.status).toBe("succeeded");
    expect(completed.result).toEqual({ done: true });
    expect(executor.executed).toHaveLength(1);
  });

  it("records executor failures as structured task errors", async () => {
    const manager = new TaskManager();
    const created = task(manager);
    const executor = new MockActionExecutor(
      ["example.run"],
      actionFailure("example_failure", "Action failed"),
    );
    const failed = await manager.execute(created.id, executor);
    expect(failed.status).toBe("failed");
    expect(failed.error).toEqual({ code: "example_failure", message: "Action failed" });
  });

  it("normalizes thrown executor errors into the result contract", async () => {
    const manager = new TaskManager();
    const created = task(manager);
    const failed = await manager.execute(created.id, {
      canExecute: () => true,
      execute: async () => {
        throw new Error("unexpected failure");
      },
    });
    expect(failed.status).toBe("failed");
    expect(failed.error).toEqual({
      code: "execution_failed",
      message: "unexpected failure",
    });
  });

  it("requests and resolves confirmation before execution", async () => {
    const manager = new TaskManager();
    const created = task(manager, "confirm");
    const executor = new MockActionExecutor(["example.run"]);
    const changes: Array<{ status: string; signal?: string }> = [];
    manager.subscribe(({ task: current, reaction }) =>
      changes.push({ status: current.status, signal: reaction.signal }),
    );
    const waiting = await manager.execute(created.id, executor);
    expect(waiting.status).toBe("permission_required");
    expect(waiting.permissionRequest).toMatchObject({
      level: "confirm",
      prompt: "Allow Example action?",
    });
    expect(executor.executed).toHaveLength(0);
    expect(changes).toContainEqual({
      status: "permission_required",
      signal: "permission_required",
    });
    const approved = manager.approvePermission(created.id);
    expect(approved.status).toBe("queued");
    expect(approved.permissionGranted).toBe(true);
    expect((await manager.execute(created.id, executor)).status).toBe("succeeded");
  });

  it("denies a permission request with a structured failure", async () => {
    const manager = new TaskManager();
    const created = task(manager, "sensitive");
    await manager.execute(created.id, new MockActionExecutor(["example.run"]));
    const denied = manager.denyPermission(created.id);
    expect(denied.status).toBe("failed");
    expect(denied.error?.code).toBe("permission_denied");
  });

  it("cancels queued, waiting, or permission-blocked work", async () => {
    const manager = new TaskManager();
    const queued = task(manager);
    expect(manager.cancel(queued.id).status).toBe("cancelled");
    const permission = task(manager, "confirm");
    await manager.execute(permission.id, new MockActionExecutor(["example.run"]));
    expect(manager.cancel(permission.id).status).toBe("cancelled");
    const waiting = task(manager);
    manager.waitForUser(waiting.id);
    expect(manager.resume(waiting.id).status).toBe("queued");
  });

  it("maps every task state to a semantic reaction", () => {
    expect(reactionForTaskStatus("queued").expression).toBe("waiting");
    expect(reactionForTaskStatus("running").expression).toBe("focused");
    expect(reactionForTaskStatus("permission_required").signal).toBe("permission_required");
    expect(reactionForTaskStatus("succeeded").expression).toBe("success");
    expect(reactionForTaskStatus("failed").signal).toBe("error");
    expect(reactionForTaskStatus("waiting_for_user").expression).toBe("waiting");
    expect(reactionForTaskStatus("cancelled").expression).toBe("neutral");
  });

  it("fails cleanly when no executor supports an action", async () => {
    const manager = new TaskManager();
    const created = task(manager);
    const failed = await manager.execute(created.id, new MockActionExecutor());
    expect(failed.error?.code).toBe("unsupported_action");
  });

  it("keeps a cancellation that happens while execution is in flight", async () => {
    const manager = new TaskManager();
    const created = task(manager);
    let finishExecution: ((result: ReturnType<typeof actionSuccess>) => void) | undefined;
    const executor = {
      canExecute: () => true,
      execute: () =>
        new Promise<ReturnType<typeof actionSuccess>>((resolve) => {
          finishExecution = resolve;
        }),
    };
    const pending = manager.execute(created.id, executor);
    expect(manager.get(created.id)?.status).toBe("running");
    expect(manager.cancel(created.id).status).toBe("cancelled");
    finishExecution?.(actionSuccess({ done: true }));
    expect((await pending).status).toBe("cancelled");
  });
});

describe("hardening invariants", () => {
  it("freezes the exact approved payload and permission snapshot", async () => {
    const manager = new TaskManager();
    const payload = {nested: {id: "original"}};
    const created = manager.create({type:"test", origin:"user", title:"Approve", action:{id:"example.run",payload,permission:"confirm"}});
    payload.nested.id = "changed";
    expect(() => (created.action.payload as typeof payload).nested.id = "forged").toThrow();
    await manager.execute(created.id, new MockActionExecutor(["example.run"]));
    manager.approvePermission(created.id);
    expect(() => manager.approvePermission(created.id)).toThrow();
    const executor = new MockActionExecutor(["example.run"]);
    await manager.execute(created.id, executor);
    expect(executor.executed[0].payload).toEqual({nested:{id:"original"}});
    expect(() => manager.approvePermission(created.id)).toThrow();
  });
  it("rejects wrong, denied and cancelled approvals without execution", async () => {
    const manager = new TaskManager(); const executor = new MockActionExecutor(["example.run"]);
    const denied = task(manager,"confirm"), cancelled = task(manager,"sensitive");
    await manager.execute(denied.id,executor); await manager.execute(cancelled.id,executor);
    manager.denyPermission(denied.id); manager.cancel(cancelled.id);
    for(const id of ["wrong",denied.id,cancelled.id]) expect(()=>manager.approvePermission(id)).toThrow();
    expect(executor.executed).toHaveLength(0);
  });
  it("aborts running work once and never accepts late success", async () => {
    const manager=new TaskManager(); const created=task(manager);
    let finish!: (result: ReturnType<typeof actionSuccess>)=>void; let signal: AbortSignal|undefined;
    const running=manager.execute(created.id,{canExecute:()=>true, execute:async (_a,s)=>{signal=s;return new Promise(resolve=>finish=resolve);}});
    await Promise.resolve(); await Promise.resolve();
    manager.cancel(created.id); const cancelled=manager.cancel(created.id);
    expect(signal?.aborted).toBe(true); finish(actionSuccess({late:true}));
    expect(await running).toBe(cancelled); expect(manager.get(created.id)?.result).toBeUndefined();
  });
  it("bounds several days of completed task history while preserving pending work", async () => {
    const manager=new TaskManager(); const pending=task(manager,"confirm");
    await manager.execute(pending.id,new MockActionExecutor(["example.run"]));
    for(let i=0;i<3000;i++){const t=task(manager);manager.updateStatus(t.id,"running");manager.complete(t.id);}
    expect(manager.list()).toHaveLength(201); expect(manager.get(pending.id)?.status).toBe("permission_required");
  });
});

it("cannot weaken mandatory sensitive-action permission through task creation",async()=>{
 const manager=new TaskManager();let invoked=false;
 const task=manager.create({type:"clipboard",title:"Read",origin:"companion",action:{id:"clipboard.read",payload:{},permission:"none"}});
 await manager.execute(task.id,{canExecute:()=>true,execute:async()=>{invoked=true;return actionSuccess({});}});
 expect(invoked).toBe(false);expect(manager.get(task.id)?.status).toBe("permission_required");
});

it("expires stale approval without leaving a reusable grant",async()=>{
 let now=0;const manager=new TaskManager(()=>new Date(now));const created=task(manager,"confirm");await manager.execute(created.id,new MockActionExecutor(["example.run"]));now=300001;expect(()=>manager.approvePermission(created.id)).toThrow("expired");expect(manager.get(created.id)?.status).toBe("failed");expect(manager.get(created.id)?.permissionGranted).toBe(false);
});
