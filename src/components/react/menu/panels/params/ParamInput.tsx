import React, { useState, useEffect } from "react";
import { X } from "lucide-react";

interface ParamInputProps {
  label: string;
  value: number | undefined;
  baseValue: number;
  onChange: (value: number | undefined) => void;
  unit?: string;
  description?: string;
}

const ParamInput: React.FC<ParamInputProps> = ({
  label,
  value,
  baseValue,
  onChange,
  unit = "",
  description,
}) => {
  const isOverridden = value !== undefined;
  const displayValue = value ?? baseValue;
  const [inputValue, setInputValue] = useState<string>(String(displayValue));

  useEffect(() => {
    setInputValue(String(displayValue));
  }, [displayValue]);

  return (
    <div className="flex items-center gap-2 mb-2">
      <label className="w-[160px] text-xs text-gray-400 shrink-0">
        {label}
        {description && (
          <span className="text-[10px] text-gray-600 block">{description}</span>
        )}
      </label>
      <input
        type="text"
        inputMode="decimal"
        value={inputValue}
        onChange={(e) => {
          const raw = e.target.value;
          setInputValue(raw);
          if (raw === "" || raw === "-" || raw === ".") return;
          const val = Number.parseFloat(raw);
          if (!Number.isNaN(val)) onChange(val);
        }}
        onBlur={() => {
          const val = Number.parseFloat(inputValue);
          if (Number.isNaN(val)) {
            setInputValue(String(displayValue));
          } else {
            setInputValue(String(val));
            onChange(val);
          }
        }}
        className={`w-[70px] px-2 py-1 rounded text-xs font-mono ${
          isOverridden
            ? "bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/50"
            : "bg-panel-bg-solid text-white border border-panel-border"
        }`}
      />
      <span className="text-[11px] text-gray-600 w-[30px]">{unit}</span>
      {isOverridden && (
        <button
          onClick={() => onChange(undefined)}
          className="text-gray-500 hover:text-gray-300"
          title="Reset to base"
        >
          <X size={12} />
        </button>
      )}
      <span className="text-[10px] text-gray-600">(base: {baseValue})</span>
    </div>
  );
};

export default ParamInput;
