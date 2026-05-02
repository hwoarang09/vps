#!/usr/bin/env node
// tools/parseSnapshot.cjs
// SnapshotLogger 출력 파일(*_snapshot.bin) 파서
//
// 사용법:
//   node tools/parseSnapshot.cjs <file.bin>                # 전체 dump
//   node tools/parseSnapshot.cjs <file.bin> --frames=5     # 처음 5 frame
//   node tools/parseSnapshot.cjs <file.bin> --vehId=111    # 특정 차량 시계열
//   node tools/parseSnapshot.cjs <file.bin> --edge=235     # 특정 edge queue 시계열
//   node tools/parseSnapshot.cjs <file.bin> --json         # JSON 출력
//
// Block format:
//   magic(2)=0xCAFE
//   ts(4)
//   numVehicles(2)
//   [vehId(2) currentEdge(2) ratio(f4) velocity(f4) stopReason(2)] × N
//   numActiveEdges(2)
//   [edgeId(2) count(2) [vehId(2)] × count] × M

const fs = require('fs');

const MAGIC = 0xCAFE;

function parseStopReason(bits) {
  const reasons = [];
  if (bits & 1)       reasons.push('OBS_LIDAR');
  if (bits & 2)       reasons.push('OBS_CAMERA');
  if (bits & 4)       reasons.push('E_STOP');
  if (bits & 8)       reasons.push('LOCKED');
  if (bits & 16)      reasons.push('DEST');
  if (bits & 32)      reasons.push('BLOCKED');
  if (bits & 64)      reasons.push('LOAD_ON');
  if (bits & 128)     reasons.push('LOAD_OFF');
  if (bits & 256)     reasons.push('NOT_INIT');
  if (bits & 512)     reasons.push('MANUAL');
  if (bits & 1024)    reasons.push('SENSORED');
  return reasons.length ? reasons.join('|') : 'NONE';
}

function parseFile(buffer) {
  const frames = [];
  let off = 0;
  while (off < buffer.length - 8) {
    const magic = buffer.readUInt16LE(off);
    if (magic !== MAGIC) {
      console.error(`[parseSnapshot] Bad magic 0x${magic.toString(16)} at offset ${off}, stopping`);
      break;
    }
    off += 2;
    const ts = buffer.readUInt32LE(off); off += 4;
    const numVeh = buffer.readUInt16LE(off); off += 2;

    const vehicles = [];
    for (let i = 0; i < numVeh; i++) {
      vehicles.push({
        vehId: buffer.readUInt16LE(off),
        currentEdge: buffer.readUInt16LE(off + 2),
        ratio: buffer.readFloatLE(off + 4),
        velocity: buffer.readFloatLE(off + 8),
        stopReason: buffer.readUInt16LE(off + 12),
      });
      off += 14;
    }

    const numEdges = buffer.readUInt16LE(off); off += 2;
    const activeEdges = [];
    for (let i = 0; i < numEdges; i++) {
      const edgeId = buffer.readUInt16LE(off); off += 2;
      const count = buffer.readUInt16LE(off); off += 2;
      const vehIds = [];
      for (let j = 0; j < count; j++) {
        vehIds.push(buffer.readUInt16LE(off));
        off += 2;
      }
      activeEdges.push({ edgeId, vehIds });
    }

    frames.push({ ts, vehicles, activeEdges });
  }
  return frames;
}

function printFrame(frame, opts) {
  console.log(`\n=== Frame ts=${frame.ts}ms (vehicles=${frame.vehicles.length}, activeEdges=${frame.activeEdges.length}) ===`);
  if (opts.vehId !== undefined) {
    const v = frame.vehicles.find(x => x.vehId === opts.vehId);
    if (v) {
      console.log(`  v=${v.vehId} edge=${v.currentEdge} ratio=${v.ratio.toFixed(4)} vel=${v.velocity.toFixed(2)} stop=${parseStopReason(v.stopReason)}`);
    }
  } else if (opts.edge !== undefined) {
    const e = frame.activeEdges.find(x => x.edgeId === opts.edge);
    if (e) {
      const ratios = e.vehIds.map(id => {
        const v = frame.vehicles.find(x => x.vehId === id);
        return v ? `v${id}@${v.ratio.toFixed(3)}` : `v${id}@?`;
      });
      console.log(`  edge=${e.edgeId} queue=[${e.vehIds.join(',')}]   ratios: ${ratios.join(', ')}`);
    }
  } else {
    // full dump (small frames only)
    if (frame.vehicles.length <= 20) {
      for (const v of frame.vehicles) {
        console.log(`  v=${v.vehId} edge=${v.currentEdge} r=${v.ratio.toFixed(3)} vel=${v.velocity.toFixed(2)} stop=${parseStopReason(v.stopReason)}`);
      }
    }
    if (frame.activeEdges.length <= 30) {
      for (const e of frame.activeEdges) {
        console.log(`  edge=${e.edgeId} count=${e.vehIds.length} queue=[${e.vehIds.join(',')}]`);
      }
    } else {
      console.log(`  (${frame.activeEdges.length} active edges - use --edge=N to see one)`);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node parseSnapshot.cjs <file.bin> [--frames=N] [--vehId=N] [--edge=N] [--json]');
    process.exit(1);
  }

  const file = args[0];
  const opts = {
    frames: undefined,
    vehId: undefined,
    edge: undefined,
    json: false,
  };
  for (const a of args.slice(1)) {
    if (a === '--json') opts.json = true;
    else if (a.startsWith('--frames=')) opts.frames = parseInt(a.slice(9), 10);
    else if (a.startsWith('--vehId=')) opts.vehId = parseInt(a.slice(8), 10);
    else if (a.startsWith('--edge=')) opts.edge = parseInt(a.slice(7), 10);
  }

  const buffer = fs.readFileSync(file);
  console.log(`File size: ${buffer.length} bytes`);

  const frames = parseFile(buffer);
  console.log(`Parsed ${frames.length} frames`);

  if (frames.length === 0) return;
  console.log(`First ts: ${frames[0].ts}ms, Last ts: ${frames[frames.length - 1].ts}ms`);

  if (opts.json) {
    const output = opts.frames ? frames.slice(0, opts.frames) : frames;
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const limit = opts.frames ?? frames.length;
  for (let i = 0; i < Math.min(limit, frames.length); i++) {
    printFrame(frames[i], opts);
  }
}

main();
