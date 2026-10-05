import type {Notice} from "./presentation";
/** Bounded presentation queue. Durable reminder records remain authoritative. */
export class NoticeQueue {
  active: Notice | null = null;
  private pending: Notice[] = [];
  private overflow = 0;
  get size() {return this.pending.length + Number(this.active !== null);}
  push(notice: Notice) {
    if(this.active?.key === notice.key || this.pending.some(n=>n.key===notice.key)) return this.active;
    if(!this.active) this.active=notice;
    else if(notice.priority > this.active.priority) {this.pending.push(this.active);this.active=notice;}
    else this.pending.push(notice);
    this.pending.sort((a,b)=>b.priority-a.priority || a.at-b.at);
    while(this.pending.length > 31) {const removed=this.pending.pop()!;if(removed.priority>=3)this.overflow++;}
    return this.active;
  }
  dismiss() {
    this.active=this.pending.shift()??null;
    if(!this.active && this.overflow) {this.active={key:"overflow",message:`${this.overflow} more alerts. Open reminders to review them.`,priority:3,at:Date.now()};this.overflow=0;}
    return this.active;
  }
}
