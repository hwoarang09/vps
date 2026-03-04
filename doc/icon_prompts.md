# VPS Icon Generation Prompts (Leonardo AI)

> **목표 스타일**: 12c.png 참조 — 둥글고 볼륨감 있는 게임 시뮬레이터 UI 아이콘
> **용도**: LV1 (하단 메뉴바) + LV2 (서브메뉴) 아이콘 교체
> **총 아이콘 수**: 약 45개

---

## 공통 설정

### Style Prompt (모든 배치에 앞에 붙이기)

```
Polished game-simulator UI icon on a dark translucent panel background (#1a1a2e).
Compact filled shape (NOT outline-only) with soft volumetric 3D emboss effect
and subtle inner glow. Colors: vibrant warm orange (#F97316) as primary,
clean white as secondary accent. Rounded smooth shapes with soft drop shadow.
Each icon sits on a dark rounded rectangle with subtle glass-morphism edge highlight.
No text, no labels, no watermarks. Centered composition, even spacing.
```

### Negative Prompt (모든 배치에 적용)

```
flat vector, thin outlines only, sharp angular edges, text labels, watermark,
realistic photograph, clipart style, low contrast, neon glow, busy background,
gradient background, multiple colors beyond orange and white
```

### Leonardo AI 설정 권장값
- **Model**: Leonardo Phoenix 또는 Leonardo Diffusion XL
- **Image Reference**: 12c.png를 Style Reference로 첨부 (Strength 0.3~0.5)
- **Resolution**: 512x512 (개별) 또는 1024x512 (2~3개 배치)
- **Guidance Scale**: 7~9

---

## Batch 1: LV1 메인 메뉴 아이콘 (10개)

### Batch 1-A: MapLoader + Statistics + Search

```
Three polished game UI icons in a 1x3 horizontal row, evenly spaced:

1) An orange folder icon with a small upward arrow on it, representing "Load File".
   The folder is rounded with a subtle 3D depth effect.

2) An orange and white pie chart icon split into 3 segments, representing "Statistics".
   One segment is white, two are orange with slight shading difference.

3) A white magnifying glass icon with orange glass lens reflection,
   representing "Search". Thick rounded handle.

[Style Prompt]
```

**파일명**: `lv1_batch1a_maploader_stats_search.png`
**적용 위치**: MapLoader, Statistics, Search 버튼

---

### Batch 1-B: Vehicle + Operation + MapBuilder

```
Three polished game UI icons in a 1x3 horizontal row, evenly spaced:

1) An orange simplified top-down car/vehicle silhouette, compact and rounded,
   representing "Vehicle Management". Modern autonomous vehicle shape.

2) A white and orange ship's helm wheel (ship wheel) with 6 spokes,
   representing "Operation Control". Center hub is orange, spokes are white.

3) An orange and white railroad track section viewed from slight angle,
   two parallel rails with cross ties, representing "Map Builder".
   Rails are white, ties are orange.

[Style Prompt]
```

**파일명**: `lv1_batch1b_vehicle_operation_mapbuilder.png`
**적용 위치**: Vehicle, Operation, MapBuilder 버튼

---

### Batch 1-C: LayoutBuilder + Visualization + DataPanel + DevTools

```
Four polished game UI icons in a 1x4 horizontal row, evenly spaced:

1) An orange modern building/factory outline with windows,
   representing "Layout Builder". 2-3 story simplified structure.

2) Orange stacked layers (3-4 horizontal planes stacked with gaps),
   representing "Visualization/Layers". Top layer slightly tilted.
   Subtle glow between layers.

3) A white and orange data table/grid icon showing a 3x3 cell grid,
   representing "Data Panel". Header row in orange, cells in white outlines.

4) An orange wrench tool icon, angled 45 degrees, representing "Developer Tools".
   Thick rounded wrench with volumetric shading.

[Style Prompt]
```

**파일명**: `lv1_batch1c_layout_vis_data_devtools.png`
**적용 위치**: LayoutBuilder, Visualization, DataPanel, DevTools 버튼

---

## Batch 2: MapLoader 서브메뉴 (LV2)

### Batch 2-A: Load CFG + Import + Export

```
Three polished game UI icons in a 1x3 horizontal row, evenly spaced:

1) An orange open folder icon with a document peeking out,
   representing "Open/Load File". Folder lid is raised.

2) An orange downward arrow entering into a horizontal tray/box shape,
   representing "Import/Download". Arrow is bold and rounded.

3) An orange upward arrow leaving from a horizontal tray/box shape,
   representing "Export/Upload". Arrow is bold and rounded.

[Style Prompt]
```

**파일명**: `lv2_batch2a_maploader_sub.png`
**적용 위치**: Load CFG, Import, Export 버튼

---

## Batch 3: Statistics 서브메뉴 (LV2)

### Batch 3-A: Realtime + Daily + Weekly

```
Three polished game UI icons in a 1x3 horizontal row, evenly spaced:

1) An orange upward trending line chart with 3 data points connected by
   smooth curves, representing "Realtime Monitoring". Small pulse dot at the end.

2) A white and orange single-page calendar icon showing one day highlighted
   in orange, representing "Daily Report". Clean rounded corners.

3) An orange vertical bar chart with 5 bars of varying heights,
   representing "Weekly Statistics". Bars have rounded tops.

[Style Prompt]
```

**파일명**: `lv2_batch3a_stats_realtime_daily_weekly.png`
**적용 위치**: Realtime, Daily, Weekly 버튼

---

### Batch 3-B: Monthly + Performance

```
Two polished game UI icons side by side:

1) A white and orange calendar icon showing a full month grid (small dots),
   representing "Monthly Report". Multiple days highlighted in orange.

2) An orange lightning bolt / zap icon with electric energy effect,
   representing "Performance Analysis". Bold zigzag shape with subtle glow.

[Style Prompt]
```

**파일명**: `lv2_batch3b_stats_monthly_performance.png`
**적용 위치**: Monthly, Performance 버튼

---

## Batch 4: Vehicle 서브메뉴 (LV2)

### Batch 4-A: Overall Status + History

```
Two polished game UI icons side by side:

1) An orange horizontal bar chart with 3 bars and a small checkmark overlay,
   representing "Overall Vehicle Status". Bars show different fill levels.

2) A white and orange document/paper icon with horizontal text lines
   and a small clock overlay in the corner, representing "Vehicle History Log".

[Style Prompt]
```

**파일명**: `lv2_batch4a_vehicle_overall_history.png`
**적용 위치**: Overall Status, History 버튼

---

## Batch 5: Operation 서브메뉴 (LV2)

### Batch 5-A: Routes + Schedule + Monitor

```
Three polished game UI icons in a 1x3 horizontal row, evenly spaced:

1) An orange folded map icon with a dotted route line and a location pin,
   representing "Routes". Map has fold creases visible.

2) A white and orange stopwatch/timer icon showing a clock face
   with a small play triangle, representing "Schedule/Timer".

3) An orange stylized eye icon with a circular iris,
   representing "Monitor/Watch". Iris has a subtle tech-pattern inside.

[Style Prompt]
```

**파일명**: `lv2_batch5a_operation_routes_schedule_monitor.png`
**적용 위치**: Routes, Schedule, Monitor 버튼

---

### Batch 5-B: Alerts + Logs

```
Two polished game UI icons side by side:

1) An orange notification bell icon with a small red/orange dot indicator
   at the top right, representing "Alerts". Bell has rounded dome shape.

2) A white and orange clipboard icon with a checkmark on it,
   representing "Operation Logs". Document has 2-3 horizontal lines visible.

[Style Prompt]
```

**파일명**: `lv2_batch5b_operation_alerts_logs.png`
**적용 위치**: Alerts, Logs 버튼

---

## Batch 6: MapBuilder 서브메뉴 (LV2) — 트랙 타입

### Batch 6-A: Straight + 90° Curve + 180° Curve

```
Three polished game UI icons in a 1x3 horizontal row, evenly spaced:

1) A white vertical straight railroad track segment with orange cross-ties,
   representing "Straight Track". Two parallel rails going vertically.

2) An orange quarter-circle curved track (90 degree turn),
   representing "90° Curve". Smooth arc from bottom to right.

3) An orange U-shaped curved track (180 degree turn),
   representing "180° Curve / U-Turn". Smooth semicircle.

[Style Prompt]
```

**파일명**: `lv2_batch6a_map_straight_curve90_curve180.png`
**적용 위치**: Straight, 90° Curve, 180° Curve 버튼

---

### Batch 6-B: S-Curve + H-Shape + R-Shape

```
Three polished game UI icons in a 1x3 horizontal row, evenly spaced:

1) An orange S-shaped smooth wavy track (sine wave shape with 2 curves),
   representing "S-Curve Track". Flowing double curve.

2) An orange hash/grid symbol (#) made of thick rounded bars,
   representing "H-Shape / Intersection Track".

3) An orange track segment that curves into an R-like shape
   (straight vertical then curves right at top), representing "R-Shape Track".

[Style Prompt]
```

**파일명**: `lv2_batch6b_map_scurve_hshape_rshape.png`
**적용 위치**: S Curve, H Shape, R Shape 버튼

---

### Batch 6-C: Junction + Bridge + Custom

```
Three polished game UI icons in a 1x3 horizontal row, evenly spaced:

1) An orange track junction/merge icon showing two paths merging into one
   (Y-shape or shuffle arrows), representing "Junction/Switch".

2) A white and orange bridge structure icon showing an elevated track
   section with support pillars underneath, representing "Bridge/Overpass".

3) An orange gear/cog icon with a small pencil overlay,
   representing "Custom Track Builder". Gear has 6 teeth, rounded.

[Style Prompt]
```

**파일명**: `lv2_batch6c_map_junction_bridge_custom.png`
**적용 위치**: Junction, Bridge, Custom 버튼

---

## Batch 7: LayoutBuilder 서브메뉴 (LV2)

### Batch 7-A: Bay Builder + Station Builder + Equipment Builder

```
Three polished game UI icons in a 1x3 horizontal row, evenly spaced:

1) An orange rounded square/rectangle outline with a small plus sign inside,
   representing "Bay Builder". Simple geometric bay area shape.

2) An orange and white factory/station building with a chimney or antenna
   on top, representing "Station Builder". Industrial facility look.

3) An orange mechanical gear icon with a smaller interlocking gear,
   representing "Equipment Builder". Two meshing gears, volumetric.

[Style Prompt]
```

**파일명**: `lv2_batch7a_layout_bay_station_equipment.png`
**적용 위치**: Bay Builder, Station Builder, Equipment Builder 버튼

---

## Batch 8: Visualization 서브메뉴 (LV2)

### Batch 8-A: Performance + Bay Label + Heatmap

```
Three polished game UI icons in a 1x3 horizontal row, evenly spaced:

1) An orange speedometer/gauge icon with the needle pointing to high,
   representing "Performance Monitor". Semicircular dial with tick marks.

2) An orange map pin / location marker icon with a small tag/label
   attached, representing "Bay Label". Pin has a rounded head.

3) An orange and white heatmap grid icon showing a 3x3 grid
   with varying opacity squares (hot=bright orange, cool=dark),
   representing "Heatmap Visualization".

[Style Prompt]
```

**파일명**: `lv2_batch8a_vis_performance_baylabel_heatmap.png`
**적용 위치**: Performance, Bay Label, Heatmap 버튼

---

### Batch 8-B: Traffic Flow + Deadlock Zone

```
Two polished game UI icons side by side:

1) An orange flowing arrows icon — multiple parallel arrows moving
   in the same direction with motion lines, representing "Traffic Flow".
   Arrows curve slightly to suggest movement.

2) An orange padlock icon in a locked position with a warning triangle
   overlay, representing "Deadlock Zone". Lock is solid and bold.

[Style Prompt]
```

**파일명**: `lv2_batch8b_vis_trafficflow_deadlock.png`
**적용 위치**: Traffic Flow, Deadlock Zone 버튼

---

## Batch 9: Search 서브메뉴 (LV2)

### Batch 9-A: Vehicle Search + Edge Search + Node Search + Station Search

```
Four polished game UI icons in a 1x4 horizontal row, evenly spaced:

1) An orange car/vehicle silhouette with a small magnifying glass overlay,
   representing "Vehicle Search".

2) An orange branching line (git-branch shape: one line splitting into two)
   with a magnifying glass, representing "Edge Search".

3) An orange filled circle/dot (node) with a subtle ring around it,
   representing "Node Search". Clean geometric circle.

4) An orange map pin/location marker with a magnifying glass overlay,
   representing "Station Search".

[Style Prompt]
```

**파일명**: `lv2_batch9a_search_vehicle_edge_node_station.png`
**적용 위치**: Vehicle Search, Edge Search, Node Search, Station Search 버튼

---

## Batch 10: DevTools 서브메뉴 (LV2)

### Batch 10-A: Lock DevTool

```
One polished game UI icon, centered:

An orange padlock icon with a small code bracket symbol (< >) overlaid
at the bottom right, representing "Lock Developer Tool".
The padlock is in a closed/locked position with volumetric shading.

[Style Prompt]
```

**파일명**: `lv2_batch10a_devtools_lock.png`
**적용 위치**: DevTools > Lock 버튼

---

## 생성 후 작업 체크리스트

### 아이콘 후처리
- [ ] 배경 제거 (투명 PNG로 변환)
- [ ] 개별 아이콘으로 크롭 (각 아이콘 정사각형으로)
- [ ] 크기 통일: 64x64px 또는 128x128px
- [ ] 파일명 규칙: `icon_{menuId}.png` (예: `icon_maploader.png`)

### 프로젝트 적용
- [ ] `src/assets/icons/` 폴더에 저장
- [ ] `MenuLevel1Config.tsx`에서 lucide-react 아이콘 → 커스텀 이미지로 교체
- [ ] `menuLevel2Config.tsx`에서 lucide-react 아이콘 → 커스텀 이미지로 교체
- [ ] active/inactive 상태 처리 (CSS filter 또는 opacity)

### 아이콘-메뉴 매핑표

| 배치 | 아이콘 | 메뉴 ID | 레벨 |
|------|--------|---------|------|
| 1-A | Folder | MapLoader | LV1 |
| 1-A | PieChart | Statistics | LV1 |
| 1-A | Magnifying Glass | Search | LV1 |
| 1-B | Car | Vehicle | LV1 |
| 1-B | Ship Wheel | Operation | LV1 |
| 1-B | Railroad Track | MapBuilder | LV1 |
| 1-C | Building | LayoutBuilder | LV1 |
| 1-C | Layers | Visualization | LV1 |
| 1-C | Table Grid | DataPanel | LV1 |
| 1-C | Wrench | DevTools | LV1 |
| 2-A | Open Folder | maploader-menu-1 | LV2 |
| 2-A | Download Arrow | maploader-menu-2 | LV2 |
| 2-A | Upload Arrow | maploader-menu-3 | LV2 |
| 3-A | Trend Line | stats-menu-1 | LV2 |
| 3-A | Calendar Day | stats-menu-2 | LV2 |
| 3-A | Bar Chart | stats-menu-3 | LV2 |
| 3-B | Calendar Month | stats-menu-4 | LV2 |
| 3-B | Lightning Bolt | stats-menu-5 | LV2 |
| 4-A | Status Bars | vehicle-menu-overall | LV2 |
| 4-A | Document Clock | vehicle-menu-history | LV2 |
| 5-A | Map Route | operation-menu-1 | LV2 |
| 5-A | Timer | operation-menu-2 | LV2 |
| 5-A | Eye | operation-menu-3 | LV2 |
| 5-B | Bell | operation-menu-4 | LV2 |
| 5-B | Clipboard Check | operation-menu-5 | LV2 |
| 6-A | Straight Track | map-menu-1 | LV2 |
| 6-A | 90° Curve | map-menu-2 | LV2 |
| 6-A | 180° Curve | map-menu-3 | LV2 |
| 6-B | S-Curve | map-menu-4 | LV2 |
| 6-B | H-Shape | map-menu-5 | LV2 |
| 6-B | R-Shape | map-menu-6 | LV2 |
| 6-C | Junction | map-menu-7 | LV2 |
| 6-C | Bridge | map-menu-8 | LV2 |
| 6-C | Custom Gear | map-menu-9 | LV2 |
| 7-A | Bay Square | layout-menu-1 | LV2 |
| 7-A | Station Building | layout-menu-2 | LV2 |
| 7-A | Equipment Gears | layout-menu-3 | LV2 |
| 8-A | Gauge | vis-performance | LV2 |
| 8-A | Map Pin Tag | vis-bay-label | LV2 |
| 8-A | Heatmap Grid | vis-heatmap | LV2 |
| 8-B | Flow Arrows | vis-traffic-flow | LV2 |
| 8-B | Lock Warning | vis-deadlock-zone | LV2 |
| 9-A | Car + Search | search-vehicle | LV2 |
| 9-A | Branch + Search | search-edge | LV2 |
| 9-A | Circle Node | search-node | LV2 |
| 9-A | Pin + Search | search-station | LV2 |
| 10-A | Lock + Code | devtools-lock | LV2 |
