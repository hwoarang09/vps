#!/usr/bin/env python3
"""
Rail topology loader (edge.map / node.map / station.map).

로그의 edge_idx (1-based, SHM 인덱스) ↔ from_node/to_node 변환,
node_idx (0-based, lock log 인덱스) ↔ node_name 변환,
edge_idx → 길이/타입 등 메타 조회.

Used by:
  - 락 분석 시 N216 = node_idx 215 같은 매핑 검증
  - edge 246 의 from/to 노드, 길이, 타입 확인
  - merge node 검출 (incoming edge 2개 이상)
  - station/loop 위치 확인 (deadlock 조사 시 srcStation.ratio 확인용)

I/O:
  Input:
    - rail_dir: railConfig 경로 (예: public/railConfig/cop)
                cop 형식 (edge.map/node.map/station.map) 또는
                stress_test 형식 (edges.cfg/nodes.cfg) 자동 감지
  Output:
    - Topology object with:
        edges: list[dict]        # 0-based, [i] = (i+1)번 edge
        nodes: list[dict]        # 0-based, [i] = (i+1)번 node
        edge_by_index(idx)       # SHM 1-based → edge dict
        node_by_index(idx)       # lock log 0-based → node dict
        edge_idx_by_name(name)   # "EDGE0246" → 246
        node_idx_by_name(name)   # "NODE0216" → 215
        merge_nodes              # set of node_name (incoming edges >= 2)
        edges_into(node_name)    # incoming edge dicts
        edges_out_of(node_name)  # outgoing edge dicts
"""

import csv
from pathlib import Path
from collections import defaultdict
from dataclasses import dataclass, field


@dataclass
class Topology:
    edges: list[dict] = field(default_factory=list)  # 0-based
    nodes: list[dict] = field(default_factory=list)  # 0-based
    stations: list[dict] = field(default_factory=list)
    _edge_name_to_idx: dict[str, int] = field(default_factory=dict)
    _node_name_to_idx: dict[str, int] = field(default_factory=dict)
    _edges_into: dict[str, list[dict]] = field(default_factory=lambda: defaultdict(list))
    _edges_out: dict[str, list[dict]] = field(default_factory=lambda: defaultdict(list))

    def edge_by_index(self, idx_1based: int) -> dict | None:
        """SHM 1-based edge index → edge dict."""
        if idx_1based < 1 or idx_1based > len(self.edges):
            return None
        return self.edges[idx_1based - 1]

    def node_by_index(self, idx_0based: int) -> dict | None:
        """lock log 0-based node index → node dict."""
        if idx_0based < 0 or idx_0based >= len(self.nodes):
            return None
        return self.nodes[idx_0based]

    def edge_idx_by_name(self, name: str) -> int | None:
        """'EDGE0246' → 246 (1-based)."""
        return self._edge_name_to_idx.get(name)

    def node_idx_by_name(self, name: str) -> int | None:
        """'NODE0216' → 215 (0-based)."""
        return self._node_name_to_idx.get(name)

    def edges_into(self, node_name: str) -> list[dict]:
        return self._edges_into.get(node_name, [])

    def edges_out_of(self, node_name: str) -> list[dict]:
        return self._edges_out.get(node_name, [])

    @property
    def merge_nodes(self) -> set[str]:
        """incoming edge 가 2개 이상인 노드."""
        return {name for name, eds in self._edges_into.items() if len(eds) >= 2}

    @property
    def branch_nodes(self) -> set[str]:
        """outgoing edge 가 2개 이상인 노드."""
        return {name for name, eds in self._edges_out.items() if len(eds) >= 2}


def _detect_format(rail_dir: Path) -> str:
    """cop format (edge.map) vs cfg format (edges.cfg) 감지."""
    if (rail_dir / "edge.map").exists():
        return "map"
    if (rail_dir / "edges.cfg").exists():
        return "cfg"
    raise FileNotFoundError(f"No edge.map or edges.cfg in {rail_dir}")


def _skip_comment_lines(path: Path) -> list[str]:
    """# 으로 시작하는 라인 + 빈 라인 스킵해서 데이터 라인만 반환 (헤더 포함)."""
    lines = []
    for line in path.read_text(encoding='utf-8').splitlines():
        s = line.strip()
        if s.startswith('#') or not s:
            continue
        lines.append(line)
    return lines


def load_topology(rail_dir: str | Path) -> Topology:
    """railConfig 폴더에서 topology 로드.

    cop format:    edge.map (rail_name,from_node,to_node,distance,...) + node.map
    cfg format:    edges.cfg (edge_name,from_node,to_node,distance,...) + nodes.cfg
    """
    rail_dir = Path(rail_dir)
    fmt = _detect_format(rail_dir)
    topo = Topology()

    if fmt == "map":
        edge_file = rail_dir / "edge.map"
        node_file = rail_dir / "node.map"
        edge_name_col = "rail_name"
    else:
        edge_file = rail_dir / "edges.cfg"
        node_file = rail_dir / "nodes.cfg"
        edge_name_col = "edge_name"

    # nodes
    nlines = _skip_comment_lines(node_file)
    if nlines:
        reader = csv.DictReader(nlines)
        for i, row in enumerate(reader):
            name = row.get('node_name')
            if not name:
                continue
            node = {'index': i, 'name': name, **row}
            topo.nodes.append(node)
            topo._node_name_to_idx[name] = i

    # edges
    elines = _skip_comment_lines(edge_file)
    if elines:
        reader = csv.DictReader(elines)
        for i, row in enumerate(reader):
            name = row.get(edge_name_col) or row.get('edge_name') or row.get('rail_name')
            if not name:
                continue
            from_n = row.get('from_node')
            to_n = row.get('to_node')
            try:
                dist_raw = row.get('distance')
                # cop edge.map 의 distance 단위가 mm (e.g., 21656 = 21.656m).
                # 'cfg' 도 동일 (21656 같은 값). m 으로 표시하려면 /1000.
                dist = float(dist_raw) / 1000.0 if dist_raw else 0.0
            except ValueError:
                dist = 0.0
            edge = {
                'index_1based': i + 1,
                'name': name,
                'from_node': from_n,
                'to_node': to_n,
                'distance_m': dist,
                'rail_type': row.get('vos_rail_type'),
                'bay_name': row.get('bay_name'),
                'raw': row,
            }
            topo.edges.append(edge)
            topo._edge_name_to_idx[name] = i + 1
            if from_n:
                topo._edges_out[from_n].append(edge)
            if to_n:
                topo._edges_into[to_n].append(edge)

    # stations (optional)
    station_file = rail_dir / "station.map"
    if not station_file.exists():
        station_file = rail_dir / "stations.cfg"
    if station_file.exists():
        slines = _skip_comment_lines(station_file)
        if slines:
            try:
                reader = csv.DictReader(slines)
                for row in reader:
                    topo.stations.append(dict(row))
            except csv.Error:
                pass

    return topo


def describe_node(topo: Topology, node_idx_0based: int) -> str:
    """node_idx (0-based) 에 대한 사람-읽을 수 있는 요약. lock log 의 node_idx 그대로 넣음."""
    node = topo.node_by_index(node_idx_0based)
    if not node:
        return f"node_idx={node_idx_0based} (out of range)"
    name = node['name']
    incoming = topo.edges_into(name)
    outgoing = topo.edges_out_of(name)
    return (f"{name} (idx={node_idx_0based})  "
            f"in={len(incoming)} out={len(outgoing)}  "
            f"{'MERGE' if len(incoming) >= 2 else ''}{'+BRANCH' if len(outgoing) >= 2 else ''}")


def describe_edge(topo: Topology, edge_idx_1based: int) -> str:
    """edge_idx (SHM 1-based) 에 대한 요약."""
    e = topo.edge_by_index(edge_idx_1based)
    if not e:
        return f"edge_idx={edge_idx_1based} (out of range)"
    return (f"{e['name']} (idx={edge_idx_1based})  "
            f"{e['from_node']} → {e['to_node']}  "
            f"{e['distance_m']:.3f}m  {e['rail_type']}  {e['bay_name']}")
