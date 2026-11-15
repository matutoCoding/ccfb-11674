/// <reference lib="webworker" />
import { computeSnowDepth, type SnowDepthInput, type SnowDepthResult } from '../domain/snow';
import { hashFloat32Array } from '../domain/util/hash';

/**
 * 造雪仿真 Worker：避免 1024² 全量计算阻塞 UI。
 * 计算本身完全确定性，Worker 只负责线程调度。
 */
export interface SnowWorkerRequest extends SnowDepthInput {
  requestId: number;
  /** true 时连跑两遍并返回双哈希，用于页面上的可复现性自检 */
  verify: boolean;
}

export interface SnowWorkerResponse {
  requestId: number;
  result: SnowDepthResult;
  hash: number;
  verifyHash?: number;
  verifyOk?: boolean;
  elapsedMs: number;
}

self.onmessage = (ev: MessageEvent<SnowWorkerRequest>) => {
  const { requestId, verify, ...input } = ev.data;
  const start = performance.now();
  const result = computeSnowDepth(input);
  const hash = hashFloat32Array(result.depth);
  const response: SnowWorkerResponse = { requestId, result, hash, elapsedMs: performance.now() - start };

  if (verify) {
    const second = computeSnowDepth(input);
    const verifyHash = hashFloat32Array(second.depth);
    response.verifyHash = verifyHash;
    response.verifyOk = verifyHash === hash;
  }
  (self as DedicatedWorkerGlobalScope).postMessage(response, [result.depth.buffer]);
};
