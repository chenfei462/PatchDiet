function toIsoString(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function deliveryKey(deliveryId) {
  const value = typeof deliveryId === "string" ? deliveryId.trim() : "";
  return value ? `delivery:${value}` : null;
}

/**
 * In-memory preview job queue — the single job-tracking module for the GitHub
 * App server.
 *
 * Delivery ids are idempotency keys: a webhook redelivery that arrives while the
 * first job is still in flight returns the original job instead of enqueueing a
 * second one. The key is released as soon as the job settles, so a later event
 * for the same pull request is analysed again instead of being dropped.
 *
 * Finished jobs are pruned once `jobTtlMs` has elapsed and the queue is capped
 * at `maxJobs` entries (oldest first) so long-running processes stay bounded.
 * Both limits default to unlimited for embedders that do not need them.
 */
export class PreviewJobQueue {
  constructor({ now = () => new Date(), maxJobs = Number.POSITIVE_INFINITY, jobTtlMs = Number.POSITIVE_INFINITY } = {}) {
    this.now = now;
    this.maxJobs = maxJobs;
    this.jobTtlMs = jobTtlMs;
    this.jobs = new Map();
    this.dedupeKeys = new Map();
    this.nextId = 1;
  }

  enqueue({ deliveryId = "", owner = "", repo = "", pullNumber = null, installationId = null, headSha = "", run } = {}) {
    const key = deliveryKey(deliveryId);

    if (key) {
      const existingId = this.dedupeKeys.get(key);
      const existingJob = existingId ? this.jobs.get(existingId) : null;
      if (existingJob && existingJob.status === "in_flight") {
        return { duplicate: true, job: existingJob };
      }
      this.dedupeKeys.delete(key);
    }

    const createdAt = toIsoString(this.now());
    const job = {
      id: `preview-${this.nextId++}`,
      status: "in_flight",
      deliveryId: typeof deliveryId === "string" ? deliveryId : "",
      owner,
      repo,
      pullNumber,
      installationId,
      headSha,
      createdAt,
      startedAt: createdAt,
      finishedAt: null,
      result: null,
      error: null,
      finishedAtMs: null
    };
    this.jobs.set(job.id, job);
    if (key) {
      this.dedupeKeys.set(key, job.id);
    }

    Promise.resolve()
      .then(() => (typeof run === "function" ? run() : undefined))
      .then(
        (result) => {
          job.result = result ?? null;
          job.status = "completed";
        },
        (error) => {
          job.status = "failed";
          job.error = error instanceof Error ? error.message : String(error);
        }
      )
      .then(() => {
        job.finishedAt = toIsoString(this.now());
        job.finishedAtMs = this.now().getTime();
        if (key && this.dedupeKeys.get(key) === job.id) {
          this.dedupeKeys.delete(key);
        }
      });

    return { duplicate: false, job };
  }

  /**
   * Drop finished jobs older than the TTL, then evict the oldest jobs until the
   * queue fits within `maxJobs`. Callers invoke this after enqueueing; in-flight
   * jobs are never TTL-pruned.
   */
  prune() {
    const nowMs = this.now().getTime();

    for (const [id, job] of this.jobs) {
      if (job.status !== "in_flight" && job.finishedAtMs !== null && nowMs - job.finishedAtMs > this.jobTtlMs) {
        this.#delete(id);
      }
    }

    while (this.jobs.size > this.maxJobs) {
      const oldest = this.jobs.keys().next();
      if (oldest.done) {
        break;
      }
      this.#delete(oldest.value);
    }
  }

  #delete(id) {
    const job = this.jobs.get(id);
    if (!job) {
      return;
    }
    this.jobs.delete(id);
    for (const [key, jobId] of this.dedupeKeys) {
      if (jobId === id) {
        this.dedupeKeys.delete(key);
      }
    }
  }

  get(id) {
    return this.jobs.get(id) ?? null;
  }

  list() {
    return Array.from(this.jobs.values()).sort((left, right) => numericId(left.id) - numericId(right.id));
  }
}

/**
 * Client-facing view of a job: strips queue-internal bookkeeping fields
 * (`finishedAtMs`) so they never leak through HTTP responses.
 */
export function publicJob(job) {
  if (!job) {
    return null;
  }
  const { finishedAtMs: _finishedAtMs, ...rest } = job;
  return rest;
}

function numericId(id) {
  const value = Number.parseInt(String(id).replace(/^preview-/u, ""), 10);
  return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
}
