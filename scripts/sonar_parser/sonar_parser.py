#!/usr/bin/env python3
"""
SonarQube Issue Parser & Classifier
====================================
sonar_agents.md 규칙 기반으로 SonarQube 이슈를 파싱·분류합니다.

Usage:
    python sonar_parser.py <input_file>         # 파일에서 읽기
    python sonar_parser.py                      # stdin에서 읽기 (붙여넣기 후 Ctrl+D)
    python sonar_parser.py -o report.md         # Markdown 보고서 출력

Example:
    python sonar_parser.py issues.txt -o report.md
"""

import re
import sys
import argparse
from dataclasses import dataclass, field
from typing import Optional
from collections import defaultdict


# ─────────────────────────────────────────────────────────────────────────────
# Rule categories (sonar_agents.md 기준)
# ─────────────────────────────────────────────────────────────────────────────

RULE_CATEGORIES = {
    "A": "Dead Code & Unused Items",
    "B": "Control Flow & Logic",
    "C": "Module & Exports",
    "D": "TypeScript & Class Structure",
    "E": "Error Handling",
    "F": "Function Structure",
    "G": "Literals & Formatting",
    "H": "Environment & Runtime",
    "I": "JSX & Accessibility",
    "Z": "Unknown (규칙 미정의)",
}

SEVERITY_EMOJI = {
    "high":   "🔴",
    "medium": "🟡",
    "low":    "🔵",
    "info":   "⚪",
}


# ─────────────────────────────────────────────────────────────────────────────
# Classifier — sonar_agents.md 규칙 매핑
# ─────────────────────────────────────────────────────────────────────────────

def classify_issue(description: str, tags: list[str]) -> tuple[str, str]:
    """
    (category_key, rule_id) 반환.
    sonar_agents.md 규칙에 없으면 ("Z", "UNKNOWN") 반환.
    """
    desc_l = description.lower()
    tags_s = set(t.lower() for t in tags)

    # ── A. Dead Code & Unused Items ──────────────────────────────────────────
    useless_assign = re.search(
        r'(useless assignment|unused import|unused variable|unused parameter)', desc_l
    )
    if useless_assign:
        if "import" in desc_l:
            return "A", "A-2 Unused Import"
        return "A", "A-1 Useless Assignment"

    if "empty block" in desc_l:
        return "A", "A-2 Empty Block"

    if "empty constructor" in desc_l:
        return "A", "A-3 Empty Constructor"

    if "commented" in desc_l or "comment" in desc_l and "remove" in desc_l:
        return "A", "A-4 Commented-out Code"

    if re.search(r"(collection.*not used|use.*collection.*or remove)", desc_l):
        return "A", "A-5 Unused Collection"

    # ── B. Control Flow & Logic ──────────────────────────────────────────────
    if re.search(r"negat|else if.*!|invert.*condition", desc_l):
        return "B", "B-1 Negated Condition in else-if"

    if re.search(r"optional chaining|\?\.", desc_l):
        return "B", "B-2 Prefer Optional Chaining"

    if re.search(r"foreach|for.?each|for-of.*instead.*for.*loop|for.*loop.*simple.*iteration", desc_l):
        return "B", "B-3 for/forEach → for...of"

    if re.search(r"lonely if|else.*\{\s*if", desc_l):
        return "B", "B-4 Lonely If in Else"

    if re.search(r"nested ternary|ternary.*nested", desc_l):
        return "B", "B-5 Nested Ternary"

    # ── C. Module & Exports ──────────────────────────────────────────────────
    if re.search(r"export.*from|re.?export", desc_l):
        return "C", "C-1 Re-export Syntax"

    if re.search(r"import.*multiple|multiple.*import|duplicate.*import", desc_l):
        return "C", "C-2 Duplicate Import"

    # ── D. TypeScript & Class Structure ─────────────────────────────────────
    if re.search(r"readonly", desc_l):
        return "D", "D-1 Readonly Modifier"

    # ── E. Error Handling ────────────────────────────────────────────────────
    if re.search(r"string\(err|err.*string|error.*strin", desc_l):
        return "E", "E-1 No Object Stringification"

    # ── F. Function Structure ────────────────────────────────────────────────
    if re.search(r"cognitive complexity", desc_l):
        return "F", "F-1 Cognitive Complexity"

    if re.search(r"(too many param|max param|parameter.*7|7.*parameter)", desc_l):
        return "F", "F-2 Max Parameters"

    # ── G. Literals & Formatting ─────────────────────────────────────────────
    if re.search(r"zero fraction|\.0\b|integer.*float", desc_l):
        return "G", "G-1 No Zero Fraction"

    # ── H. Environment & Runtime ─────────────────────────────────────────────
    if re.search(r"window\b|globalthis", desc_l):
        return "H", "H-1 globalThis over window"

    # ── I. JSX & Accessibility ───────────────────────────────────────────────
    if re.search(r"(interactive|accessibility|role=|tabindex|keyboard)", desc_l):
        return "I", "I-1 Interactive Element Accessibility"

    if re.search(r"(jsx.*spacing|child.*spacing|whitespace.*jsx)", desc_l):
        return "I", "I-2 JSX Child Element Spacing"

    # ── Z. Unknown ───────────────────────────────────────────────────────────
    return "Z", "UNKNOWN"


# ─────────────────────────────────────────────────────────────────────────────
# Data model
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class SonarIssue:
    file_path: str
    line: Optional[int]
    description: str
    severity: str          # high / medium / low / info
    tags: list[str] = field(default_factory=list)
    effort: str = ""
    age: str = ""
    category_key: str = "Z"
    rule_id: str = "UNKNOWN"

    def severity_emoji(self) -> str:
        return SEVERITY_EMOJI.get(self.severity.lower(), "⚪")


# ─────────────────────────────────────────────────────────────────────────────
# Parser
# ─────────────────────────────────────────────────────────────────────────────

# ── 패턴 ──────────────────────────────────────────────────────────────────────
# 파일 경로: src/... 또는 스탠드얼론 경로
_RE_FILE = re.compile(r'^(src/\S+\.\w+|[A-Za-z0-9_./-]+\.(ts|tsx|js|jsx|py|kt|java))\s*$')
_RE_LINE = re.compile(r'L(\d+)\s*$')
_RE_EFFORT = re.compile(r'(\d+\s*(?:min|hr|hour|day)s?\s+effort)', re.I)
_RE_AGE = re.compile(r'(\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)', re.I)
_RE_SEVERITY = re.compile(r'^(Critical|High|Medium|Low|Info)\s*$', re.I)
_RE_SEV_NUM = re.compile(r'^\d+\s*$')   # "2", "3", "4" — severity level number


def parse_issues(raw_text: str) -> list[SonarIssue]:
    """raw SonarQube 붙여넣기 텍스트 → SonarIssue 목록"""
    issues: list[SonarIssue] = []

    # 현재 파일 트래킹
    current_file = ""

    # 이슈별 누적 버퍼
    desc_lines: list[str] = []
    severity = "medium"
    tags: list[str] = []
    line_no: Optional[int] = None
    effort = ""
    age = ""

    def flush():
        nonlocal desc_lines, severity, tags, line_no, effort, age
        if desc_lines and current_file:
            desc = " ".join(desc_lines).strip()
            if desc:
                issue = SonarIssue(
                    file_path=current_file,
                    line=line_no,
                    description=desc,
                    severity=severity,
                    tags=list(tags),
                    effort=effort,
                    age=age,
                )
                issue.category_key, issue.rule_id = classify_issue(desc, tags)
                issues.append(issue)
        desc_lines = []
        severity = "medium"
        tags = []
        line_no = None
        effort = ""
        age = ""

    # 불필요한 UI 텍스트 필터 (SonarQube UI 잔재)
    _NOISE = {
        "Open", "Not assigned", "Intentionality", "Maintainability",
        "Adaptability", "Consistency", "Testability", "Reliability",
        "Robustness", "Security", "cwe", "unused", "es2015",
        "type-dependent", "brain-overload", "architecture", "convention",
        "suspicious", "+", "...", "35 of 35 shown",
    }

    lines = raw_text.splitlines()
    i = 0
    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()
        i += 1

        # 빈 줄 → skip
        if not stripped:
            continue

        # 노이즈 토큰 → skip
        if stripped in _NOISE:
            continue

        # 파일 경로 감지
        m_file = _RE_FILE.match(stripped)
        if m_file:
            flush()
            current_file = stripped
            continue

        # 라인 번호 (L246 형태)
        m_line = _RE_LINE.match(stripped)
        if m_line:
            # 라인 번호 등장 = 이 이슈의 마지막 메타 → flush 트리거
            line_no = int(m_line.group(1))
            # 이후 effort / age 수집
            while i < len(lines):
                nxt = lines[i].strip()
                i += 1
                if not nxt:
                    continue
                if _RE_EFFORT.search(nxt):
                    effort = nxt.strip()
                elif _RE_AGE.search(nxt):
                    age = nxt.strip()
                else:
                    # 다음 이슈 시작 혹은 파일명 → 되돌리기
                    i -= 1
                    break
            flush()
            continue

        # severity 숫자 ("2", "3", "4") → skip (다음 줄에 텍스트 레이블이 옴)
        if _RE_SEV_NUM.match(stripped):
            continue

        # severity 레이블
        m_sev = _RE_SEVERITY.match(stripped)
        if m_sev:
            severity = m_sev.group(1).lower()
            continue

        # effort
        if _RE_EFFORT.search(stripped):
            effort = stripped
            continue

        # age
        if _RE_AGE.search(stripped):
            age = stripped
            continue

        # 그 외 → description 또는 tag
        # 태그는 소문자 단어, 최대 20자, 하이픈 허용
        if re.match(r'^[a-z][a-z0-9\-]{0,19}$', stripped):
            # 짧은 소문자 토큰 → 태그로 간주
            tags.append(stripped)
        else:
            # description 텍스트 누적
            desc_lines.append(stripped)

    flush()
    return issues


# ─────────────────────────────────────────────────────────────────────────────
# Report generators
# ─────────────────────────────────────────────────────────────────────────────

def print_console_report(issues: list[SonarIssue]) -> None:
    """터미널 출력용 요약 보고서"""
    by_category: dict[str, list[SonarIssue]] = defaultdict(list)
    for iss in issues:
        by_category[iss.category_key].append(iss)

    unknowns: list[SonarIssue] = by_category.get("Z", [])

    print("\n" + "=" * 70)
    print("  SONAR REPORT")
    print("=" * 70)
    print(f"  총 이슈: {len(issues)}개\n")

    for key in sorted(RULE_CATEGORIES):
        group = by_category.get(key, [])
        if not group:
            continue
        label = RULE_CATEGORIES[key]
        print(f"▶ [{key}] {label}  ({len(group)}개)")
        print("  " + "─" * 60)
        for iss in group:
            sev = iss.severity_emoji()
            line_str = f"L{iss.line}" if iss.line else "L?"
            print(f"  {sev} [{iss.rule_id}]")
            print(f"     파일: {iss.file_path}:{line_str}")
            print(f"     설명: {iss.description}")
            if iss.tags:
                print(f"     태그: {', '.join(iss.tags)}")
            print()

    # Unknown 이슈 별도 강조
    if unknowns:
        print("=" * 70)
        print("  ⚠️  규칙 미정의 이슈 (sonar_agents.md에 추가 필요)")
        print("=" * 70)
        for iss in unknowns:
            line_str = f"L{iss.line}" if iss.line else "L?"
            print(f"  • {iss.file_path}:{line_str}")
            print(f"    설명: {iss.description}")
            print(f"    태그: {', '.join(iss.tags)}")
            print()


def build_markdown_report(issues: list[SonarIssue]) -> str:
    """Markdown 보고서 문자열 반환"""
    by_category: dict[str, list[SonarIssue]] = defaultdict(list)
    for iss in issues:
        by_category[iss.category_key].append(iss)

    lines: list[str] = []
    lines.append("# Sonar Report\n")
    lines.append(f"총 이슈: **{len(issues)}개**\n")

    # 카테고리별 테이블
    lines.append("## 분류 요약\n")
    lines.append("| 카테고리 | 규칙 그룹 | 이슈 수 |")
    lines.append("|:---:|:---|:---:|")
    for key in sorted(RULE_CATEGORIES):
        cnt = len(by_category.get(key, []))
        if cnt:
            label = RULE_CATEGORIES[key]
            lines.append(f"| **{key}** | {label} | {cnt} |")
    lines.append("")

    # 카테고리별 상세
    lines.append("## 상세 이슈\n")
    for key in sorted(RULE_CATEGORIES):
        group = by_category.get(key, [])
        if not group:
            continue
        label = RULE_CATEGORIES[key]
        lines.append(f"### [{key}] {label}\n")
        lines.append("| # | 심각도 | Rule | 파일:줄 | 설명 |")
        lines.append("|:---:|:---:|:---|:---|:---|")
        for idx, iss in enumerate(group, 1):
            sev = iss.severity_emoji()
            line_str = f"L{iss.line}" if iss.line else "L?"
            file_short = iss.file_path.replace("src/", "")
            desc = iss.description.replace("|", "\\|")
            lines.append(
                f"| {idx} | {sev} {iss.severity.title()} "
                f"| {iss.rule_id} "
                f"| `{file_short}:{line_str}` "
                f"| {desc} |"
            )
        lines.append("")

    # Unknown 이슈 (규칙 추가 필요)
    unknowns = by_category.get("Z", [])
    if unknowns:
        lines.append("---\n")
        lines.append("## ⚠️ 규칙 미정의 이슈 (sonar_agents.md 추가 검토 필요)\n")
        for iss in unknowns:
            line_str = f"L{iss.line}" if iss.line else "L?"
            lines.append(f"- **`{iss.file_path}:{line_str}`**")
            lines.append(f"  - 설명: {iss.description}")
            lines.append(f"  - 태그: `{', '.join(iss.tags) or '없음'}`")
            lines.append("")

    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="SonarQube 이슈 텍스트를 파싱해 sonar_agents.md 규칙으로 분류합니다."
    )
    parser.add_argument(
        "input", nargs="?",
        help="입력 파일 경로 (생략 시 stdin)"
    )
    parser.add_argument(
        "-o", "--output",
        help="Markdown 보고서 출력 파일 (생략 시 터미널 출력)"
    )
    args = parser.parse_args()

    # 입력 읽기
    if args.input:
        with open(args.input, encoding="utf-8") as f:
            raw = f.read()
    else:
        print("붙여넣기 후 Ctrl+D (EOF)로 입력 완료:", file=sys.stderr)
        raw = sys.stdin.read()

    issues = parse_issues(raw)

    if not issues:
        print("⚠️  이슈를 파싱하지 못했습니다. 입력 형식을 확인하세요.", file=sys.stderr)
        sys.exit(1)

    if args.output:
        md = build_markdown_report(issues)
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(md)
        print(f"✅ Markdown 보고서 저장: {args.output}", file=sys.stderr)
        # 콘솔에도 요약 출력
        print_console_report(issues)
    else:
        print_console_report(issues)


if __name__ == "__main__":
    main()
