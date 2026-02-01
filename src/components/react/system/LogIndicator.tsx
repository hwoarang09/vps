// components/react/system/LogIndicator.tsx
// HUD Status Indicator - Shows log file management buttons in top-right corner

import React, { useState } from "react";
import { FileText, FileCode } from "lucide-react";
import { useMenuStore } from "@/store/ui/menuStore";
import { menuButtonVariants } from "@/components/react/menu/shared/menuStyles";
import { twMerge } from "tailwind-merge";
import LogFileManager from "@/components/test/VehicleTest/LogFileManager";
import DevLogFileManager from "@/components/test/VehicleTest/DevLogFileManager";

const LogIndicator: React.FC = () => {
  const { showTooltip, hideTooltip } = useMenuStore();
  const [activeLogDropdown, setActiveLogDropdown] = useState<'logs' | 'devlogs' | null>(null);

  const handleMouseEnter = (
    e: React.MouseEvent,
    menuId: string,
    message: string
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    showTooltip(
      menuId,
      message,
      {
        x: rect.left + rect.width / 2,
        y: rect.bottom,
      },
      2 // level 2 = tooltip appears below
    );
  };

  const handleMouseLeave = () => {
    hideTooltip();
  };

  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
      {/* Container with menu style */}
      <div
        className={twMerge(
          "flex items-center gap-1 p-1 rounded-xl border-2",
          "bg-menu-container-bg border-menu-border-container",
          "shadow-menu-container-glow opacity-[0.98]"
        )}
      >
        {/* Logs Button */}
        <div className="relative">
          <button
            onClick={() => setActiveLogDropdown(activeLogDropdown === 'logs' ? null : 'logs')}
            onMouseEnter={(e) => handleMouseEnter(e, "logs", "OPFS Log Files")}
            onMouseLeave={handleMouseLeave}
            className={twMerge(
              menuButtonVariants({ active: activeLogDropdown === 'logs', size: "small" }),
              "w-10 h-10"
            )}
          >
            <FileText
              size={18}
              className={activeLogDropdown === 'logs' ? "text-white" : "text-purple-400"}
            />
          </button>
          {/* Dropdown positioned below */}
          {activeLogDropdown === 'logs' && (
            <div className="absolute top-12 right-0">
              <LogFileManager
                isOpen={true}
                onToggle={() => setActiveLogDropdown(null)}
                hideButton={true}
              />
            </div>
          )}
        </div>

        {/* DevLogs Button */}
        <div className="relative">
          <button
            onClick={() => setActiveLogDropdown(activeLogDropdown === 'devlogs' ? null : 'devlogs')}
            onMouseEnter={(e) => handleMouseEnter(e, "devlogs", "Dev Log Files")}
            onMouseLeave={handleMouseLeave}
            className={twMerge(
              menuButtonVariants({ active: activeLogDropdown === 'devlogs', size: "small" }),
              "w-10 h-10"
            )}
          >
            <FileCode
              size={18}
              className={activeLogDropdown === 'devlogs' ? "text-white" : "text-green-400"}
            />
          </button>
          {/* Dropdown positioned below */}
          {activeLogDropdown === 'devlogs' && (
            <div className="absolute top-12 right-0">
              <DevLogFileManager
                isOpen={true}
                onToggle={() => setActiveLogDropdown(null)}
                hideButton={true}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LogIndicator;
