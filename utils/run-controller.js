class RunController {
  constructor() {
    this.stopLevel = 0; // 0=running, 1=soft stop, 2=hard stop
    this.stoppedAt = null;
    this.reason = '';
    this.tasks = new Map(); // id -> { filename, stage: 'pending'|'running'|'done', cancel?: ()=>void }
    this.nextId = 1;
  }

  createTaskId(meta) {
    const id = this.nextId++;
    this.tasks.set(id, { filename: meta?.filename || '', stage: 'pending' });
    return id;
  }

  updateTask(id, updates) {
    const t = this.tasks.get(id);
    if (!t) return;
    Object.assign(t, updates);
    this.tasks.set(id, t);
  }

  softStop(reason = 'user requested soft stop') {
    if (this.stopLevel >= 1) return;
    this.stopLevel = 1;
    this.stoppedAt = new Date();
    this.reason = reason;
  }

  hardStop(reason = 'user requested hard stop') {
    if (this.stopLevel >= 2) return;
    this.stopLevel = 2;
    this.stoppedAt = new Date();
    this.reason = reason;
    // 触发进行中任务的取消
    for (const [, t] of this.tasks.entries()) {
      if (t.stage === 'running' && typeof t.cancel === 'function') {
        try { t.cancel(); } catch {}
      }
    }
  }

  isSoftStopped() { return this.stopLevel >= 1 && this.stopLevel < 2; }
  isHardStopped() { return this.stopLevel >= 2; }
  isStopped() { return this.stopLevel >= 1; }

  /**
   * 返回当前仍为 pending 或 running 的任务快照
   */
  getUnfinishedTasks() {
    const res = [];
    for (const [id, t] of this.tasks.entries()) {
      if (t.stage === 'pending' || t.stage === 'running') {
        res.push({ id, ...t });
      }
    }
    return res;
  }
}

module.exports = { RunController };


