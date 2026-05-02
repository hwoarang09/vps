// logger/SnapshotLogger.ts
// 디버그 스냅샷 로거 - 매 N ms마다 모든 vehicle 위치 + edge queue 상태를 가변 크기 binary block으로 기록.
//
// Block format (가변):
//   magic(2)=0xCAFE
//   ts(4)              simulation time ms
//   numVehicles(2)
//   [vehId(2) currentEdge(2) ratio(f4) velocity(f4) stopReason(2)] × numVehicles  (14B per veh)
//   numActiveEdges(2)
//   [edgeId(2) count(2) [vehId(2)] × count] × numActiveEdges                       (4 + 2C bytes per edge)
//
// File: <sessionId>_<fabId>_snapshot.bin
//
// 특징:
//   - 가변 크기라 RECORD_SIZE 시스템 안 씀. 별도 binary writer.
//   - block 단위로 buffer flush (block 시작 magic으로 splittable).

// FileSystemSyncAccessHandle은 Worker 컨텍스트에서만 사용 가능
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const FileSystemSyncAccessHandle: any;

export interface SnapshotVehicle {
  vehId: number;
  currentEdge: number;
  ratio: number;
  velocity: number;
  stopReason: number;
}

export interface SnapshotEdge {
  edgeId: number;
  vehIds: number[];
}

export interface SnapshotData {
  ts: number;
  vehicles: SnapshotVehicle[];
  activeEdges: SnapshotEdge[];
}

const MAGIC = 0xCAFE;
const BUFFER_SIZE = 256 * 1024; // 256KB; flush 시 OPFS에 write
const PERIODIC_FLUSH_INTERVAL = 10_000; // 10s

export interface SnapshotLoggerConfig {
  sessionId: string;
  fabId?: string;
}

export class SnapshotLogger {
  private readonly config: SnapshotLoggerConfig;
  private buffer: ArrayBuffer = new ArrayBuffer(BUFFER_SIZE);
  private view: DataView = new DataView(this.buffer);
  private offset = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handle: any | null = null;
  private fileOffset = 0;
  private flushTimerId: ReturnType<typeof setInterval> | null = null;

  constructor(config: SnapshotLoggerConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    const fileName = `${this.config.sessionId}${this.config.fabId ? '_' + this.config.fabId : ''}_snapshot.bin`;
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(fileName, { create: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let handle: any;
    try {
      handle = await (fileHandle as any).createSyncAccessHandle();
    } catch {
      await new Promise((r) => setTimeout(r, 100));
      handle = await (fileHandle as any).createSyncAccessHandle();
    }
    this.handle = handle;
    this.fileOffset = (handle as { getSize(): number }).getSize();

    this.flushTimerId = setInterval(() => this.flush(), PERIODIC_FLUSH_INTERVAL);
  }

  /**
   * 한 frame snapshot block 기록
   */
  writeSnapshot(data: SnapshotData): void {
    if (!this.handle) return;

    // block 크기 계산 후 buffer 부족 시 flush
    const blockSize =
      2 + 4 + 2                                       // magic + ts + numVehicles
      + data.vehicles.length * 14
      + 2                                              // numActiveEdges
      + data.activeEdges.reduce((sum, e) => sum + 4 + 2 * e.vehIds.length, 0);

    if (this.offset + blockSize > BUFFER_SIZE) {
      this.flush();
    }
    if (blockSize > BUFFER_SIZE) {
      // block 단독으로 buffer 초과 — 큰 buffer로 즉시 직접 쓰기
      this.writeOversizedBlock(data, blockSize);
      return;
    }

    // magic + header
    this.view.setUint16(this.offset, MAGIC, true); this.offset += 2;
    this.view.setUint32(this.offset, data.ts, true); this.offset += 4;
    this.view.setUint16(this.offset, data.vehicles.length, true); this.offset += 2;

    // vehicles
    for (const v of data.vehicles) {
      this.view.setUint16(this.offset, v.vehId & 0xFFFF, true); this.offset += 2;
      this.view.setUint16(this.offset, v.currentEdge & 0xFFFF, true); this.offset += 2;
      this.view.setFloat32(this.offset, v.ratio, true); this.offset += 4;
      this.view.setFloat32(this.offset, v.velocity, true); this.offset += 4;
      this.view.setUint16(this.offset, v.stopReason & 0xFFFF, true); this.offset += 2;
    }

    // edges
    this.view.setUint16(this.offset, data.activeEdges.length, true); this.offset += 2;
    for (const e of data.activeEdges) {
      this.view.setUint16(this.offset, e.edgeId & 0xFFFF, true); this.offset += 2;
      this.view.setUint16(this.offset, e.vehIds.length, true); this.offset += 2;
      for (const id of e.vehIds) {
        this.view.setUint16(this.offset, id & 0xFFFF, true); this.offset += 2;
      }
    }
  }

  /** block이 buffer보다 커서 직접 쓰기 (드문 케이스) */
  private writeOversizedBlock(data: SnapshotData, blockSize: number): void {
    const buf = new ArrayBuffer(blockSize);
    const view = new DataView(buf);
    let off = 0;
    view.setUint16(off, MAGIC, true); off += 2;
    view.setUint32(off, data.ts, true); off += 4;
    view.setUint16(off, data.vehicles.length, true); off += 2;
    for (const v of data.vehicles) {
      view.setUint16(off, v.vehId & 0xFFFF, true); off += 2;
      view.setUint16(off, v.currentEdge & 0xFFFF, true); off += 2;
      view.setFloat32(off, v.ratio, true); off += 4;
      view.setFloat32(off, v.velocity, true); off += 4;
      view.setUint16(off, v.stopReason & 0xFFFF, true); off += 2;
    }
    view.setUint16(off, data.activeEdges.length, true); off += 2;
    for (const e of data.activeEdges) {
      view.setUint16(off, e.edgeId & 0xFFFF, true); off += 2;
      view.setUint16(off, e.vehIds.length, true); off += 2;
      for (const id of e.vehIds) { view.setUint16(off, id & 0xFFFF, true); off += 2; }
    }
    if (this.handle) {
      this.handle.write(new Uint8Array(buf), { at: this.fileOffset });
      this.fileOffset += blockSize;
    }
  }

  flush(): void {
    if (!this.handle || this.offset === 0) return;
    const slice = new Uint8Array(this.buffer, 0, this.offset);
    this.handle.write(slice, { at: this.fileOffset });
    this.fileOffset += this.offset;
    this.offset = 0;
  }

  async close(): Promise<void> {
    this.flush();
    if (this.flushTimerId) {
      clearInterval(this.flushTimerId);
      this.flushTimerId = null;
    }
    if (this.handle) {
      try { this.handle.flush?.(); } catch { /* ignore */ }
      try { this.handle.close(); } catch { /* ignore */ }
      this.handle = null;
    }
  }
}
