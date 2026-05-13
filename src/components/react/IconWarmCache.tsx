import React from "react";

// 모든 메뉴 PNG 아이콘을 항상 살아있는 <img>로 마운트해 둔다.
// 브라우저는 마운트된 <img>의 decoded bitmap을 유지하므로, MenuLevel1/2가
// 열렸다 닫혀도 재디코드 없이 즉시 paint된다.
const iconModules = import.meta.glob(
  "/src/assets/icons/**/*.png",
  { eager: true, query: "?url", import: "default" },
) as Record<string, string>;

const ICON_URLS: string[] = Object.values(iconModules);

// 메뉴에서 가장 큰 크기로 디코드해 둬야 작은 사이즈에도 그대로 사용됨.
const WARM_SIZE = 38;

const IconWarmCache: React.FC = () => (
  <div
    aria-hidden
    style={{
      position: "fixed",
      left: -9999,
      top: -9999,
      width: WARM_SIZE,
      height: WARM_SIZE,
      pointerEvents: "none",
      opacity: 0,
    }}
  >
    {ICON_URLS.map((src) => (
      <img
        key={src}
        src={src}
        alt=""
        width={WARM_SIZE}
        height={WARM_SIZE}
        draggable={false}
      />
    ))}
  </div>
);

export default IconWarmCache;
