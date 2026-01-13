# VPS High-Performance Logging Architecture Spec

## 1. 개요 (Overview)
수만 대의 차량 시뮬레이션(VPS)에서 발생하는 대량의 로그 데이터를 **Main Thread의 렌더링 성능 저하 없이** 수집, 저장, 전송하는 시스템을 구축한다. 
핵심은 **"로깅 전용 워커(Dedicated Logger Worker)"**와 **"Zero-Copy 데이터 전송"**, 그리고 **"OPFS(Local) / Cloud(Remote) 하이브리드 저장"** 전략이다.

## 2. 아키텍처 디자인 (Architecture)

### 구조 (Topology)
시스템은 3계층으로 구성된다.

1.  **Main Thread (Manager):** 워커 생성 및 `MessageChannel`을 통한 워커 간 파이프라인 연결만 담당.
2.  **Simulation Workers (Producers):** 물리 연산 수행 중 로그를 바이너리로 패킹하여 Logger에게 **소유권 이전(Transfer)**.
3.  **Logger Worker (Consumer):** 모든 로그를 수신하여 설정된 모드(`OPFS` vs `CLOUD`)에 따라 처리.

### 데이터 흐름 (Data Flow)
`Sim Worker` --(Transferable ArrayBuffer)--> `Logger Worker` --(Mode Split)--> `[Disk/Network]`

---

## 3. 데이터 프로토콜 (Data Protocol)

### 바이너리 포맷 (Binary Packing)
JSON 텍스트가 아닌, C-Structure 형태의 고정 길이 바이너리로 저장한다. (Record당 **10 Bytes**)

| Field | Type | Size | Description |
| :--- | :--- | :--- | :--- |
| **Timestamp** | `Uint32` | 4 bytes | 시뮬레이션 시간 또는 Epoch Time |
| **VehID** | `Uint16` | 2 bytes | 차량 ID (0 ~ 65,535) |
| **EdgeID** | `Uint16` | 2 bytes | 엣지(도로) ID (매핑 테이블 별도 관리) |
| **Status** | `Uint8` | 1 byte | 상태 코드 (1:진입, 2:이탈, 3:에러 등) |
| **Padding** | `Uint8` | 1 byte | 메모리 정렬(Alignment) 및 예비용 |

---

## 4. 컴포넌트별 구현 로직 (Implementation Logic)

### A. Main Thread (Orchestrator)
* **역할:** `SimWorker`와 `LoggerWorker`를 다이렉트로 연결한다.
* **구현 가이드:**
    1.  `LoggerWorker` 생성 및 초기화 (`INIT` 메시지로 모드 설정).
    2.  `SimWorker` 생성 (N개).
    3.  `MessageChannel`을 생성한다.
    4.  `port1`은 Logger에게, `port2`는 Sim에게 `postMessage`로 전달한다.
    5.  이후 Main Thread는 로깅 프로세스에 일절 관여하지 않는다.

### B. Simulation Worker (Producer)
* **역할:** 로그 생산 및 전송 (I/O Blocking 없음).
* **핵심 로직:**
    1.  `4KB` 크기의 `ArrayBuffer`를 할당해둔다.
    2.  이벤트 발생 시 `DataView`를 이용해 버퍼에 바이너리 데이터를 쓴다.
    3.  버퍼가 가득 차면 `postMessage(buffer, [buffer])`를 호출하여 **소유권을 Logger에게 넘긴다.**
    4.  **중요:** 전송 즉시 새로운 `ArrayBuffer`를 재할당한다 (Double Buffering 개념).

### C. Logger Worker (Consumer & Router)
* **역할:** 중앙 집중식 로그 처리 및 저장소 추상화.
* **설정 값 (`CONFIG.MODE`):**
    * `OPFS`: 회사 내부용 / 로컬 디버깅용.
    * `CLOUD`: 개인 포트폴리오 / 대규모 데이터 수집용.

#### 시나리오 1: OPFS Mode (Local Disk)
1.  초기화 시 `navigator.storage.getDirectory()`로 샌드박스 파일 시스템 접근.
2.  `createSyncAccessHandle()`을 열어 **동기식 쓰기 권한** 획득.
3.  Sim에게서 버퍼가 도착하면 즉시 `handle.write(buffer)` 수행.
4.  메모리에 데이터를 쌓아두지 않음 (메모리 효율 최적화).
5.  종료 시 `flush()` 및 `close()`.

#### 시나리오 2: Cloud Mode (S3/R2)
1.  초기화 시 임시 메모리 배열(`ChunkList`) 준비.
2.  Sim에게서 버퍼가 도착하면 `ChunkList.push(buffer)`로 메모리에 적재.
3.  누적 데이터가 **5MB**에 도달하면:
    * `Blob`으로 병합.
    * S3/R2 Presigned URL로 `fetch(PUT)` 업로드.
    * `ChunkList` 초기화.

---

## 5. 데이터 분석 파이프라인 (Analysis)

### Python (Numpy + Polars)
저장된 바이너리(`*.bin`) 파일은 **CSV 변환 없이** 바로 분석한다.

* **Loader:** `numpy.memmap`을 사용하여 대용량 파일도 메모리 매핑으로 즉시 로드.
* **Processor:** `Polars` DataFrame으로 변환 (Zero-Copy).
* **Goal:** Edge별 통행량($V$)과 통행시간($T$)을 집계하여 BPR 파라미터($\alpha, \beta$) 회귀분석 수행.

---

## 6. 작업 지시 사항 (Action Plan)

다음 순서대로 코드를 구현하시오. 디테일한 에러 처리는 생략하고 핵심 로직 위주로 작성할 것.

1.  **Shared:** 바이너리 패킹/언패킹을 위한 상수 및 유틸리티 정의.
2.  **LoggerWorker:** `OPFS`와 `CLOUD` 모드를 분기 처리하는 `onmessage` 핸들러 구현.
3.  **SimWorker:** `Transferable Object`를 사용하여 오버헤드 없이 버퍼를 던지는 로직 구현.
4.  **Main:** 위 워커들을 `MessageChannel`로 엮는 부트스트랩 코드 작성.
5.  **Tools (Python):** 생성된 바이너리 로그가 정상인지 검증하는 Python 파서 스크립트 작성.