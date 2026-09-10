# 2주차 — 지구 · 달 · 인공위성의 변환 설계

- 이름: 홍길동
- 저장소: https://github.com/hong/cg-2026-solar
- 실행: [Task 1](task1.html) · [Task 2](task2.html) · [Task 3](task3.html)

## Task 1 — 실제 비율로 배치하기

### 조사한 값

| 항목 | 값 | 출처 |
| --- | --- | --- |
| 지구 반지름 | 6371 km | 위키백과 |
| 달까지의 거리 | 384400 km | 위키백과 |


### 단위를 정한 방법

1,000km을 `1` 로 두었습니다. 숫자가 너무 커지면 ...

### 내가 넣은 변환

```json
{
  "range": {"x": "400", "y": "400", "z": "400"},
  "objects": [
    {"id": "earth", "name": "지구", "color": [0.35, 0.6, 0.95], "steps": [{"type": "Su", "args": ["6.371"]}]},
    {"id": "moon", "name": "달", "color": [0.78, 0.78, 0.82], "steps": [{"type": "Rz","args": ["t"]},{"type": "T", "args": ["384.4","0","0"]}, {"type": "Su", "args": ["1.737"]}]},
    {"id": "sat", "name": "인공위성", "color": [0.95, 0.72, 0.35], "steps": [{"type": "Rx", "args": ["7"]},{"type": "Ry", "args": ["t*450"]}, {"type": "T", "args": ["6.842", "0", "0"]},{"type": "Su","args": ["0.00003"]}]}}
```

![Task 1 결과](images/task1.png)

## Task 2 — NDC 범위에 맞추기

...
