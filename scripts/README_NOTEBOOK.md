# Edge Transit Analysis Notebook 사용 가이드

## 수정 사항 요약

### ✅ 1. Pandas → Polars 변경
- **2-5배 빠른 성능**: Rust 기반 멀티코어 처리
- **메모리 효율**: pandas보다 적은 메모리 사용
- **API 변경**:
  - `.groupby()` → `.group_by()`
  - `.nunique()` → `.n_unique()`
  - `.dropna()` → `.drop_nulls()`

### ✅ 2. Matplotlib → Plotly 변경
- **인터랙티브 차트**: 줌, 팬, 호버 정보 제공
- **더 나은 시각화**: 색상, 레이아웃 개선
- **구글 코랩 최적화**: 브라우저에서 바로 인터랙션 가능

### ✅ 3. Edge ID 표시 형식 (E0001)
- `edge_id` 0 → `E0001` 형식으로 변환
- `edge_id_fmt` 컬럼 추가
- 모든 차트에서 자동 적용

### ✅ 4. 혼잡도 계산 개선
**Edge Type별 기대 속도 반영:**
```python
EXPECTED_SPEEDS = {
    'LINEAR': 3.0,      # 직선: 빠름
    'CURVE_90': 2.2,    # 곡선: 느림
    'CURVE_180': 2.0,
    'CURVE_CSC': 2.2,
    'S_CURVE': 2.3,
    'LEFT_CURVE': 2.2,
    'RIGHT_CURVE': 2.2,
}
```

**혼잡도 공식:**
```
혼잡도 = 통과 횟수 × (실제 통과시간 / Edge Type별 기대 통과시간)
```

### ✅ 5. Polars 대용량 데이터 처리
- 메모리 사용량 체크 함수 추가
- Lazy API 예제 제공
- 최적화 팁 문서화

## 구글 코랩 성능 가이드

### Polars vs Pandas
| 항목 | Pandas | Polars |
|------|--------|--------|
| 속도 | 기준 | 5-10배 빠름 |
| 메모리 | 기준 | 2-5배 적음 |
| 병렬 처리 | 제한적 | 멀티코어 완전 활용 |

### 코랩 환경별 권장
| 환경 | RAM | 권장 데이터 크기 | 비용 |
|------|-----|-----------------|------|
| 무료 | ~12GB | 1GB 이하 | 무료 |
| Pro | ~25GB | 3-5GB | $10/월 |
| Pro+ | ~50GB | 10GB | $50/월 |

### 대용량 데이터 처리 팁

**1. 필요한 컬럼만 선택:**
```python
df_small = df.select(['edge_id', 'transit_time', 'speed'])
```

**2. 시간대 필터링:**
```python
df_filtered = df.filter(
    (pl.col('timestamp') >= 10000) &
    (pl.col('timestamp') <= 60000)
)
```

**3. Lazy API 사용:**
```python
# CSV를 Lazy하게 읽기
lazy_df = pl.scan_csv('large_file.csv')
result = lazy_df.filter(...).group_by(...).collect()
```

## 테스트 결과

### 테스트 파일 생성
```bash
python3 generate_test_log.py
```

**생성된 파일:**
- `test_edge_transit_5k.bin` (5,000 records, 136.7 KB)

### 검증 결과
```
✓ 총 레코드 수: 5,000
✓ Unique Edges: 200
✓ Edge Type 분포: 균등 분포 (각 14-15%)
✓ Edge ID 포맷: E0001, E0002, ...
✓ Transit Time: 301-3648 ms
✓ Throughput: 18.2 transits/sec
```

## 사용 방법

### 1. 구글 코랩에서 노트북 열기
1. 구글 드라이브에 `edge_transit_analysis.ipynb` 업로드
2. 더블클릭으로 열기
3. "Colab에서 열기" 클릭

### 2. 로그 파일 업로드
```python
# 노트북 셀에서 실행
LOG_DIR = Path('/content/drive/MyDrive/vps_logs')
LOG_DIR.mkdir(exist_ok=True)
```

구글 드라이브 폴더에 `.bin` 파일 업로드

### 3. 셀 실행
- 위에서부터 순서대로 셀 실행 (Shift+Enter)
- 또는 "런타임" → "모두 실행"

### 4. 분석 결과 확인
- 인터랙티브 차트로 시각화
- 혼잡한 Edge 확인 (E0001 형식)
- Edge Type별 성능 비교

## 주요 분석 항목

1. **Throughput Analysis**: 시간대별 처리량
2. **Transit Time**: Edge 통과 시간 분포
3. **Edge Congestion**: Edge Type별 기대 속도 반영한 혼잡도
4. **Vehicle Utilization**: 차량 활용률
5. **Fab Comparison**: Fab 간 성능 비교
6. **Experiment Comparison**: 여러 실험 결과 비교

## 문제 해결

### Q: 메모리 부족 에러
**A:** 다음을 시도하세요:
1. 필요한 컬럼만 선택
2. 시간대 필터링으로 데이터 줄이기
3. 코랩 Pro로 업그레이드

### Q: 차트가 느림
**A:** Plotly 차트는 데이터가 많으면 느릴 수 있습니다:
1. 샘플링: `df.sample(fraction=0.1)`
2. 집계 후 시각화: `group_by()` 사용

### Q: Edge Type이 잘못 표시됨
**A:** 바이너리 형식이 맞는지 확인:
- RECORD_SIZE = 28 bytes
- Edge Type: 0-6 범위

## API 호환성

이 노트북은 다음 환경에서 테스트되었습니다:
- Polars 0.19+ (when-then 체인 사용)
- Plotly 5.0+
- Python 3.8+

구글 코랩에는 모두 설치되어 있습니다.
