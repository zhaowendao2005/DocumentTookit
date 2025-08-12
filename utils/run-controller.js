class RunController {
  constructor() {
    this.stopped = false;
    this.stoppedAt = null;
    this.reason = '';
    this.tasks = new Map(); // id -> { filename, stage: 'pending'|'running'|'done' }
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

  stop(reason = 'user requested stop') {
    if (this.stopped) return;
    this.stopped = true;
    this.stoppedAt = new Date();
    this.reason = reason;
  }

  isStopped() {
    return this.stopped;
  }

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


