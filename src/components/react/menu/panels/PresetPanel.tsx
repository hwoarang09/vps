// panels/PresetPanel.tsx
// Operation > Preset — 파라미터 프리셋 불러오기 전용 패널

import React, { useEffect, useState } from "react";
import {
  type ParameterPreset,
  loadParameterPresets,
  applyPreset,
  saveActivePreset,
  loadActivePreset,
} from "@/config/react/parameterPreset";
import {
  panelTitleVariants,
  panelCardVariants,
  panelTextVariants,
} from "../shared/panelStyles";

interface PresetEntry {
  fileName: string;
  preset: ParameterPreset;
}

const PresetPanel: React.FC = () => {
  const [entries, setEntries] = useState<PresetEntry[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([loadParameterPresets(), loadActivePreset()])
      .then(([loaded, savedFile]) => {
        setEntries(loaded);
        setActiveFile(savedFile);
      })
      .catch((e) => console.error("Failed to load presets:", e))
      .finally(() => setLoading(false));
  }, []);

  const handleLoad = (entry: PresetEntry) => {
    applyPreset(entry.preset);
    setActiveFile(entry.fileName);
    saveActivePreset(entry.fileName);
  };

  if (loading) {
    return (
      <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
        Loading presets...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className={panelTitleVariants({ size: "lg", color: "cyan" })}>
        Parameter Preset
      </h3>
      <p className={panelTextVariants({ variant: "muted", size: "sm" })}>
        클릭하면 파라미터가 즉시 적용됩니다
      </p>
      <div className="space-y-2">
        {entries.map((entry) => (
          <button
            key={entry.fileName}
            onClick={() => handleLoad(entry)}
            className={panelCardVariants({
              variant: activeFile === entry.fileName ? "glow-cyan" : "interactive",
            })}
            style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
          >
            <div>
              <div className="font-medium text-white text-xs">{entry.preset.name}</div>
              {entry.preset.description && (
                <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
                  {entry.preset.description}
                </div>
              )}
            </div>
          </button>
        ))}
        {entries.length === 0 && (
          <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
            프리셋이 없습니다. public/config/parameterMap/ 에 JSON 파일을 추가하세요.
          </div>
        )}
      </div>
    </div>
  );
};

export default PresetPanel;
