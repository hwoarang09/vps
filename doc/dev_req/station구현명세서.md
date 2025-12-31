Agent에게 전달할 수정된 **Station 시스템 구현 명세서(Markdown)**입니다.
사용자가 요청한 대로 **모든 CSV 컬럼 유지**, **Z축 고정(3.8)**, **Type별 색상 렌더링**을 포함했습니다.

---

# Station System Implementation Spec

## 1. 개요 (Overview)

Station 정보를 관리하는 Store와 3D 공간에 시각화하는 Renderer를 구현한다.

* **Store**: CSV의 모든 컬럼을 데이터 구조에 포함하며, 좌표는 Node/Edge Barcode를 기준 비율로 재계산하여 저장한다.
* **Renderer**: Station Type에 따라 색상이 구분되는 단순 직육면체(Box) 형태로 렌더링한다.

## 2. 데이터 구조 (Data Structure)

### 2.1 Interface Definition

CSV의 모든 컬럼을 보존하되, 렌더링을 위한 계산된 좌표(`position`)를 별도로 포함한다.

```typescript
export interface Station {
  // --- Raw CSV Data (All columns preserved) ---
  station_name: string;
  editor_x: string;       // CSV 원본 값 (참고용)
  editor_y: string;       // CSV 원본 값 (참고용)
  barcode_x: number;      // 위치 계산의 기준 값
  barcode_y: number;
  barcode_z: number;
  barcode_r: number;      // Rotation (Degree)
  bay_name: string;
  station_type: string;   // OHB, STK, EQ, etc.
  port_id: string;
  port_type_code: string;
  direction_code: string;
  link_sc_id: string;
  buffer_size: string;
  mode_type: string;
  floor: string;
  zone_id: string;
  rail_index: string;
  sc_id: string;
  e84: string;
  teached: string;
  look_down: string;
  nearest_edge: string;   // 위치 계산을 위한 참조 Edge
  nearest_edge_distance: string;
  eq_id: string;

  // --- Computed Data ---
  position: {             // 실제 렌더링에 사용될 재계산된 좌표
    x: number;
    y: number;
    z: number;            // station_type에 따라 결정 (EQ: 0, OHB: 3, STK: 1)
  };
}

```

## 3. Station Store (`stationStore.ts`)

### 3.1 로직 명세

1. **Dependencies**: `useNodeStore`, `useEdgeStore`, `PapaParse`
2. **Load Process**:
* `nodes.cfg`, `edges.cfg`가 로드된 이후 실행되어야 함.
* CSV를 파싱하여 `Station[]` 배열 생성.


3. **Coordinate Calculation (핵심)**:
* 각 Station row에 대해 `nearest_edge`를 찾는다.
* 해당 Edge의 `from_node`, `to_node`를 찾는다.

* **비율(t) 계산**:
$$t = \frac{\text{Station.barcode\_x} - \text{FromNode.barcode}}{\text{ToNode.barcode} - \text{FromNode.barcode}}$$

* **Base Position 계산** (Edge 상의 위치):
$$x_{base} = \text{FromNode.x} + (\text{ToNode.x} - \text{FromNode.x}) \times t$$
$$y_{base} = \text{FromNode.y} + (\text{ToNode.y} - \text{FromNode.y}) \times t$$

* **Lateral Offset 계산** (좌우 오프셋):
  * Edge의 진행 방향에 수직인 방향으로 오프셋 적용
  * `barcode_y` 값에 따라 오프셋 거리 결정:
    * `+100`: 오른쪽으로 100mm (0.1m)
    * `-100`: 왼쪽으로 100mm (0.1m)
    * `0`: 중앙 (오프셋 없음)
    * 일반적으로 barcode_y 값을 1000으로 나누어 미터 단위로 변환
  * Edge 방향 벡터를 90도 회전하여 수직 벡터 계산
  * 최종 위치: `(x, y) = (x_base, y_base) + (barcode_y / 1000) × perpendicular_vector`
  * 참고: `direction_code`는 포트 방향(1=IN, 2=OUT, 3=IN/OUT)을 나타내며 위치 계산에는 사용하지 않음

* **Z 좌표 계산** (station_type 기준):
  * `EQ`: 0 (바닥)
  * `OHB`: 3
  * `STK`: 1
  * Default: 3.8

* 계산된 `x, y, z`를 `position` 속성에 할당한다.



## 4. Station Renderer (`StationRenderer.tsx`)

### 4.1 렌더링 명세

* **Geometry**: 단순 Box 형태 (예: `args={[0.6, 0.6, 0.2]}`)
* **Position**: Store의 `station.position` 사용.
* **Rotation**:
* Z축 회전: `station.barcode_r` 값을 사용.
* 단, 데이터가 Degree 단위이므로 Radian으로 변환 필요 ().


* **Color Mapping (by `station_type`)**:
* **OHB**: Blue (`#0000FF` or similar)
* **STK** (Stocker): Yellow (`#FFFF00` or similar)
* **EQ** (Equipment): Purple (`#800080` or similar)
* **Default**: Gray (`#CCCCCC`) - 위 타입에 해당하지 않는 경우.



### 4.2 컴포넌트 구조 예시

```tsx
// Pseudo Code
export const StationRenderer = () => {
  const stations = useStationStore((state) => state.stations);

  return (
    <group>
      {stations.map((station) => (
        <mesh
          key={station.station_name}
          position={[station.position.x, station.position.y, station.position.z]}
          rotation={[0, 0, THREE.MathUtils.degToRad(station.barcode_r)]}
        >
          <boxGeometry args={[0.8, 0.8, 0.1]} /> {/* 크기는 적절히 조정 */}
          <meshStandardMaterial color={getStationColor(station.station_type)} />
        </mesh>
      ))}
    </group>
  );
};

const getStationColor = (type: string) => {
  switch (type) {
    case 'OHB': return '#4169E1'; // Royal Blue
    case 'STK': return '#FFD700'; // Gold
    case 'EQ':  return '#9370DB'; // Medium Purple
    default:    return '#A9A9A9'; // Dark Gray
  }
};

```

---

### Agent 지시사항 (Instruction)

1. 위의 데이터 구조를 사용하여 `src/store/map/stationStore.ts`를 구현하세요.
2. 계산 로직은 반드시 Barcode 비율 방식을 따라야 하며, 좌우 오프셋 및 Z 좌표 규칙을 준수하세요.
3. `src/components/three/map/StationRenderer.tsx`를 구현하여 Station을 시각화하세요.
4. Renderer는 `station_type`에 따른 색상 분기 처리를 반드시 포함해야 합니다.