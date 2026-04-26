// components/react/menu/CommandPalette.tsx
import React, { useEffect, useState, useMemo, useCallback } from "react";
import { Command as Cmdk } from "cmdk";
import { buildCommands, type Command } from "./data/commands";

const SECTION_LABELS: Record<string, string> = {
  navigation: "Navigation",
  visualization: "Visualization",
  fab: "Fab",
  simulation: "Simulation",
};

const CommandPalette: React.FC = () => {
  const [open, setOpen] = useState(false);

  // Global keyboard listener: Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Build commands fresh each time palette opens (picks up current fab list etc.)
  const commands = useMemo(() => (open ? buildCommands() : []), [open]);

  // Group by section
  const grouped = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const cmd of commands) {
      let arr = map.get(cmd.section);
      if (!arr) {
        arr = [];
        map.set(cmd.section, arr);
      }
      arr.push(cmd);
    }
    return map;
  }, [commands]);

  const handleSelect = useCallback(
    (value: string) => {
      const cmd = commands.find((c) => c.id === value);
      if (cmd) {
        setOpen(false);
        cmd.run();
      }
    },
    [commands],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Dialog */}
      <div
        className="relative w-full max-w-[520px] rounded-xl border border-gray-600 bg-gray-900/95 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Cmdk label="Command Palette" loop>
          {/* Search input */}
          <div className="flex items-center gap-2 border-b border-gray-700 px-4 py-3">
            <span className="text-gray-500 text-sm">{">"}</span>
            <Cmdk.Input
              autoFocus
              placeholder="Type a command..."
              className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-600 outline-none"
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
              }}
            />
            <kbd className="hidden sm:inline-flex items-center gap-1 rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500">
              ESC
            </kbd>
          </div>

          {/* Command list */}
          <Cmdk.List className="max-h-[320px] overflow-y-auto p-2">
            <Cmdk.Empty className="py-6 text-center text-xs text-gray-600">
              No results found.
            </Cmdk.Empty>

            {Array.from(grouped.entries()).map(([section, cmds]) => (
              <Cmdk.Group
                key={section}
                heading={SECTION_LABELS[section] ?? section}
              >
                {cmds.map((cmd) => (
                  <Cmdk.Item
                    key={cmd.id}
                    value={cmd.id}
                    keywords={cmd.keywords}
                    onSelect={handleSelect}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-300 cursor-pointer data-[selected=true]:bg-gray-800 data-[selected=true]:text-white transition-colors"
                  >
                    <span className="truncate">{cmd.label}</span>
                  </Cmdk.Item>
                ))}
              </Cmdk.Group>
            ))}
          </Cmdk.List>
        </Cmdk>
      </div>
    </div>
  );
};

export default CommandPalette;
