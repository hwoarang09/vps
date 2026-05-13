// 모든 아이콘을 사전에 받아두고 디코드까지 완료시켜서, 메뉴 진입 시
// <img> 첫 마운트에서 추가 디코드/네트워크가 안 일어나게 한다.
const iconModules = import.meta.glob(
  "/src/assets/icons/**/*.{png,svg,jpg,jpeg,webp}",
  { eager: true, query: "?url", import: "default" },
) as Record<string, string>;

const ICON_URLS: string[] = Object.values(iconModules);

const preloadSingle = (src: string): Promise<void> =>
  new Promise<void>((resolve) => {
    const img = new Image();
    const done = () => resolve();
    img.onerror = done;
    img.src = src;
    // decode()는 받은 비트맵까지 만들어둔다. onload만으론 첫 페인트 시 디코드 비용 그대로.
    if (typeof img.decode === "function") {
      img
        .decode()
        .then(done)
        .catch(done);
    } else {
      img.onload = done;
    }
  });

export function preloadMenuIcons(): Promise<void> {
  return Promise.all(ICON_URLS.map(preloadSingle)).then(() => undefined);
}
