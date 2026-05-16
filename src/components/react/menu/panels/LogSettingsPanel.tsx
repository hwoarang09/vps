// components/react/menu/panels/LogSettingsPanel.tsx
// 로그 설정 UI — 3그룹(+snapshot) 체크박스 + 펼침 세부토글.
// SimLogFileManager 의 "설정" 탭과 DevTools 메뉴 패널 양쪽에서 재사용된다.
// 인라인 스타일로 self-contained — 어느 컨테이너에 넣어도 동작.

import React, { useRef, useEffect, useState } from "react";
import {
  useLogSettingsStore,
  LOG_GROUPS,
  LOG_EVENT_LABELS,
  getGroupState,
  type LogEventKey,
  type GroupCheckState,
} from "@/store/ui/logSettingsStore";

/** 3-state 체크박스 — all/some/none */
const TriCheckbox: React.FC<{
  state: GroupCheckState | boolean;
  onChange: (next: boolean) => void;
}> = ({ state, onChange }) => {
  const ref = useRef<HTMLInputElement>(null);
  const checked = state === "all" || state === true;
  const indeterminate = state === "some";

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      style={{ cursor: "pointer", width: 14, height: 14, accentColor: "#9b59b6", flexShrink: 0 }}
    />
  );
};

const GroupRow: React.FC<{ groupKey: string }> = ({ groupKey }) => {
  const group = LOG_GROUPS[groupKey];
  const logEvents = useLogSettingsStore((s) => s.logEvents);
  const setEvent = useLogSettingsStore((s) => s.setEvent);
  const setGroup = useLogSettingsStore((s) => s.setGroup);
  const [expanded, setExpanded] = useState(false);

  const groupState = getGroupState(logEvents, groupKey);
  const hasDetail = group.events.length > 1;

  return (
    <div style={{ borderBottom: "1px solid #383838" }}>
      {/* 그룹 행 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
        }}
      >
        <TriCheckbox state={groupState} onChange={(on) => setGroup(groupKey, on)} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "#ddd", fontSize: 12, fontWeight: 700 }}>{group.label}</div>
          <div style={{ color: "#888", fontSize: 10 }}>{group.desc}</div>
        </div>
        {hasDetail && (
          <button
            onClick={() => setExpanded((v) => !v)}
            title="세부 이벤트 토글"
            style={{
              background: "transparent",
              border: "1px solid #555",
              borderRadius: 3,
              color: "#aaa",
              fontSize: 10,
              cursor: "pointer",
              padding: "2px 6px",
              flexShrink: 0,
            }}
          >
            {expanded ? "▲ 세부" : "▼ 세부"}
          </button>
        )}
      </div>

      {/* 세부 이벤트 토글 */}
      {expanded && hasDetail && (
        <div style={{ padding: "0 10px 8px 32px", display: "flex", flexDirection: "column", gap: 4 }}>
          {group.events.map((ev: LogEventKey) => (
            <label
              key={ev}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: "#bbb",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={!!logEvents[ev]}
                onChange={(e) => setEvent(ev, e.target.checked)}
                style={{ cursor: "pointer", width: 12, height: 12, accentColor: "#9b59b6" }}
              />
              {LOG_EVENT_LABELS[ev]}
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

const LogSettingsPanel: React.FC = () => {
  const logSessionNote = useLogSettingsStore((s) => s.logSessionNote);
  const setSessionNote = useLogSettingsStore((s) => s.setSessionNote);
  const resetDefaults = useLogSettingsStore((s) => s.resetDefaults);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* 안내 */}
      <div
        style={{
          padding: "8px 10px",
          fontSize: 10,
          color: "#e0a050",
          background: "rgba(224,160,80,0.08)",
          borderBottom: "1px solid #383838",
        }}
      >
        ⚠ 런 시작 전 설정 — 시뮬 시작 후엔 반영되지 않음
      </div>

      {/* 세션 메모 */}
      <div style={{ padding: "8px 10px", borderBottom: "1px solid #383838" }}>
        <div style={{ color: "#888", fontSize: 10, marginBottom: 3 }}>세션 메모 (파일명에 붙음)</div>
        <input
          type="text"
          value={logSessionNote}
          onChange={(e) => setSessionNote(e.target.value)}
          placeholder="예: ml_run1"
          style={{
            width: "100%",
            background: "#2a2a2a",
            color: "#ddd",
            border: "1px solid #555",
            borderRadius: 4,
            padding: "4px 8px",
            fontSize: 11,
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* 그룹들 */}
      {Object.keys(LOG_GROUPS).map((gk) => (
        <GroupRow key={gk} groupKey={gk} />
      ))}

      {/* 리셋 */}
      <div style={{ padding: "8px 10px" }}>
        <button
          onClick={resetDefaults}
          style={{
            background: "#3a3a3a",
            border: "1px solid #555",
            borderRadius: 3,
            color: "#bbb",
            fontSize: 10,
            cursor: "pointer",
            padding: "4px 10px",
          }}
        >
          기본값으로 리셋
        </button>
      </div>
    </div>
  );
};

export default LogSettingsPanel;
