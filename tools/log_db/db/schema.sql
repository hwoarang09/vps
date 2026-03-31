-- VPS Log DB Schema
-- 실사용 이벤트 4개 + sessions 테이블

CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    started_at TIMESTAMPTZ DEFAULT now(),
    mode TEXT NOT NULL,
    vehicle_count INT,
    map_name TEXT,
    note TEXT
);

CREATE TABLE ml_edge_transit (
    session_id TEXT NOT NULL,
    ts INT NOT NULL,
    veh_id INT NOT NULL,
    edge_id INT NOT NULL,
    enter_ts INT NOT NULL,
    exit_ts INT NOT NULL,
    edge_len REAL NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ml_lock (
    session_id TEXT NOT NULL,
    ts INT NOT NULL,
    veh_id INT NOT NULL,
    node_idx SMALLINT NOT NULL,
    event_type SMALLINT NOT NULL,
    wait_ms INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE dev_transfer (
    session_id TEXT NOT NULL,
    ts INT NOT NULL,
    veh_id INT NOT NULL,
    from_edge INT NOT NULL,
    to_edge INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE dev_path (
    session_id TEXT NOT NULL,
    ts INT NOT NULL,
    veh_id INT NOT NULL,
    dest_edge INT NOT NULL,
    path_len INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ml_replay_snapshot (
    session_id TEXT NOT NULL,
    ts INT NOT NULL,
    veh_id INT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    z REAL NOT NULL,
    edge_idx INT NOT NULL,
    ratio REAL NOT NULL,
    speed REAL NOT NULL,
    status INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_edge_transit_session_edge ON ml_edge_transit(session_id, edge_id);
CREATE INDEX idx_edge_transit_session_veh ON ml_edge_transit(session_id, veh_id);
CREATE INDEX idx_lock_session_node ON ml_lock(session_id, node_idx);
CREATE INDEX idx_lock_session_veh ON ml_lock(session_id, veh_id);
CREATE INDEX idx_transfer_session_veh ON dev_transfer(session_id, veh_id);
CREATE INDEX idx_path_session_veh ON dev_path(session_id, veh_id);
CREATE INDEX idx_replay_session_ts ON ml_replay_snapshot(session_id, ts);
CREATE INDEX idx_replay_session_veh ON ml_replay_snapshot(session_id, veh_id);
