#!/usr/bin/env python3
"""Build a static review site from notes/*.md.

This script is deliberately stdlib-only so it can run on a bare Linux server
or a local machine without installing packages. It parses the real heading
variants found in the notes, then writes site/data/notes.json for the
front-end to render.
"""

from __future__ import annotations

import json
import re
import html
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NOTES_DIR = ROOT / "notes"
SITE_DIR = ROOT / "site"
DATA_DIR = SITE_DIR / "data"
FILENAME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})_(.+)\.md$")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
TABLE_LINE_RE = re.compile(r"^\s*\|.*\|\s*$")
SEP_CELL_RE = re.compile(r"^:?-{3,}:?$")
WEEKDAYS = "一二三四五六日"
TZ_SHANGHAI = timezone(timedelta(hours=8))

SKIP_HEADING_KEYWORDS = ("练习方式", "后续记录模板", "记录模板")
SCENE_HEADING_RE = re.compile(r"练习[一二三四五六七八九十0-9]+")


def classify_heading(text: str) -> str:
    t = text.strip()
    if any(k in t for k in SKIP_HEADING_KEYWORDS):
        return "skip"
    if re.match(r"^日期", t) and "场景" in t:
        return "skip"
    if "中文原意" in t:
        return "chinese"
    if "最终英文" in t or "整理后的英文" in t:
        return "english"
    if "追问" in t:
        return "qa"
    if any(k in t for k in ("重点纠正", "重点修正")):
        return "corrections"
    if "重点表达" in t:
        return "expressions"
    if "重点词汇" in t:
        return "vocab"
    if "待确认" in t:
        return "pending"
    if "下次复习" in t:
        return "review"
    if t == "备注" or t.startswith("备注"):
        return "note"
    if SCENE_HEADING_RE.search(t) or (re.match(r"^\d{4}-\d{2}-\d{2}", t) and "｜" in t and "练习" in t):
        return "scene"
    return "other"


def clean_title(h1: str, fallback: str) -> str:
    t = h1.strip()
    t = re.sub(r"^\d{4}-\d{2}-\d{2}\s*", "", t)
    t = re.sub(r"^[｜|]\s*", "", t)
    t = re.sub(r"^工作英语练习[：:]\s*", "", t)
    t = t.strip(" ：:｜|")
    return t or fallback.replace("_", " ")


def weekday_zh(date_str: str) -> str:
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    return "周" + WEEKDAYS[dt.weekday()]


def inline_md(text: str) -> str:
    text = html.escape(text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<em>\1</em>", text)
    return text


def split_table_row(line: str) -> list[str]:
    line = line.strip().strip("|")
    return [cell.strip() for cell in line.split("|")]


def is_sep_row(cells: list[str]) -> bool:
    return all(SEP_CELL_RE.match(re.sub(r"\s", "", c) or "") for c in cells) and cells


def parse_table(lines: list[str]) -> dict:
    rows = [split_table_row(line) for line in lines]
    if not rows:
        return {"columns": [], "rows": []}
    header = rows[0]
    body = [r for r in rows[1:] if not is_sep_row(r)]
    width = len(header)
    normalized = []
    for row in body:
        if len(row) < width:
            row = row + [""] * (width - len(row))
        normalized.append(row[:width])
    return {"columns": header, "rows": normalized}


def parse_blocks(text: str) -> list[dict]:
    lines = text.splitlines()
    blocks: list[dict] = []
    i = 0

    def flush_paragraph(buf: list[str]) -> None:
        chunk = "\n".join(buf).strip()
        if not chunk:
            return
        for para in re.split(r"\n\s*\n", chunk):
            para = para.strip()
            if para:
                blocks.append({"type": "paragraph", "text": para, "html": inline_md(para).replace("\n", "<br>")})

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if TABLE_LINE_RE.match(line):
            table_lines = []
            while i < len(lines) and TABLE_LINE_RE.match(lines[i]):
                table_lines.append(lines[i])
                i += 1
            table = parse_table(table_lines)
            if table["columns"]:
                blocks.append({"type": "table", **table})
            continue
        if re.match(r"^[-*]\s+", stripped):
            items = []
            while i < len(lines) and re.match(r"^[-*]\s+", lines[i].strip()):
                items.append(re.sub(r"^[-*]\s+", "", lines[i].strip()))
                i += 1
            blocks.append({
                "type": "list",
                "items": items,
                "html_items": [inline_md(x) for x in items],
            })
            continue
        # collect ordinary text until a blank-line-separated special block
        buf = []
        while i < len(lines) and not TABLE_LINE_RE.match(lines[i]) and not re.match(r"^[-*]\s+", lines[i].strip()):
            buf.append(lines[i])
            i += 1
            # keep going through blank lines that are still part of paragraphs
            if i < len(lines) and lines[i].strip() == "":
                # peek: if next non-empty is table/list, stop after including the blank
                j = i
                while j < len(lines) and lines[j].strip() == "":
                    j += 1
                if j < len(lines) and (TABLE_LINE_RE.match(lines[j]) or re.match(r"^[-*]\s+", lines[j].strip())):
                    break
        flush_paragraph(buf)
    return blocks


def text_of_blocks(blocks: list[dict]) -> str:
    parts = []
    for b in blocks:
        if b["type"] == "paragraph":
            parts.append(b["text"])
        elif b["type"] == "list":
            parts.extend(b["items"])
        elif b["type"] == "table":
            parts.append(" ".join(b["columns"]))
            for row in b["rows"]:
                parts.append(" ".join(row))
    return "\n".join(parts)


def extract_trailing_note(raw: str) -> tuple[str, str | None]:
    """Pull a trailing '备注：' paragraph out of a section body."""
    match = re.search(r"(?:\n|^)备注[：:]\s*", raw)
    if not match:
        return raw, None
    # only treat as trailing note if it is near the end (no heading after)
    body = raw[: match.start()].rstrip()
    note = raw[match.end() :].strip()
    if not note:
        return raw, None
    return body, note



def match_tagged_line(s: str, letter: str) -> str | None:
    """Parse '**Q: text**', '**A:** text', or '**A**: text'."""
    m = re.match(rf"^\*\*{letter}:\s*(.*?)\s*\*\*\s*$", s)
    if m:
        return m.group(1).strip()
    m = re.match(rf"^\*\*{letter}:\s*\*\*\s*(.*)$", s)
    if m:
        return m.group(1).strip()
    m = re.match(rf"^\*\*{letter}\*\*\s*[：:]?\s*(.*)$", s)
    if m:
        return m.group(1).strip()
    return None


def parse_qa(raw: str) -> dict:
    items: list[dict] = []
    supplements: list[dict] = []
    current: dict | None = None
    mode: str | None = None  # q, a, supp
    pending_field: str | None = None

    def finalize() -> None:
        nonlocal current
        if current and (current.get("q_en") or current.get("a_en") or current.get("text")):
            items.append(current)
        current = None

    def add_text(field_base: str, value: str, is_zh: bool) -> None:
        nonlocal current, pending_field
        if current is None:
            current = {"q_en": "", "q_zh": "", "a_en": "", "a_zh": ""}
        key = field_base + ("_zh" if is_zh else "_en")
        if current.get(key):
            current[key] = current[key] + "\n" + value
        else:
            current[key] = value
        pending_field = key

    def looks_zh(s: str) -> bool:
        return bool(re.search(r"[\u4e00-\u9fff]", s))

    for line in raw.splitlines():
        s = line.strip()
        if not s:
            continue
        supp = re.match(r"^\*\*补充[^*]*\*\*\s*$", s) or s.startswith("**补充")
        q = match_tagged_line(s, "Q")
        a = match_tagged_line(s, "A")
        if supp:
            finalize()
            mode = "supp"
            label = re.sub(r"^\*\*|\*\*$", "", s).strip()
            supplements.append({"label": label, "en": "", "zh": ""})
            pending_field = None
            continue
        if q:
            finalize()
            current = {"q_en": (q or "").strip(), "q_zh": "", "a_en": "", "a_zh": ""}
            mode = "q"
            pending_field = "q_en" if current["q_en"] else None
            continue
        if a:
            if current is None:
                current = {"q_en": "", "q_zh": "", "a_en": "", "a_zh": ""}
            current["a_en"] = (current.get("a_en") or "")
            ans = (a or "").strip()
            if ans:
                current["a_en"] = ans
            mode = "a"
            pending_field = "a_en" if ans else "a_en"
            continue
        zh_label = re.match(r"^中文[：:]\s*(.*)$", s)
        if zh_label:
            value = zh_label.group(1).strip()
            if mode == "supp" and supplements:
                supplements[-1]["zh"] = (supplements[-1]["zh"] + "\n" + value).strip() if supplements[-1]["zh"] else value
            elif mode == "q":
                add_text("q", value, True)
            elif mode == "a":
                add_text("a", value, True)
            continue
        if mode == "supp" and supplements:
            if looks_zh(s):
                supplements[-1]["zh"] = (supplements[-1]["zh"] + "\n" + s).strip() if supplements[-1]["zh"] else s
            else:
                supplements[-1]["en"] = (supplements[-1]["en"] + "\n" + s).strip() if supplements[-1]["en"] else s
            continue
        if mode in ("q", "a"):
            is_zh = looks_zh(s)
            add_text(mode, s, is_zh)
            continue
        # preamble in a QA section
        if current is None:
            current = {"q_en": "", "q_zh": "", "a_en": "", "a_zh": "", "text": s}
        else:
            current["text"] = (current.get("text") or "") + "\n" + s

    finalize()
    # drop empty preamble-only stubs
    cleaned = []
    preamble = []
    for it in items:
        if it.get("q_en") or it.get("a_en"):
            cleaned.append({k: (it.get(k) or "").strip() for k in ("q_en", "q_zh", "a_en", "a_zh")})
        elif it.get("text"):
            preamble.append(it["text"])
    return {"items": cleaned, "supplements": supplements, "preamble": "\n".join(preamble).strip()}


def parse_note_file(path: Path) -> dict | None:
    match = FILENAME_RE.match(path.name)
    if not match:
        return None
    date, slug_title = match.groups()
    raw = path.read_text(encoding="utf-8")
    lines = raw.splitlines()

    # Split into heading-delimited sections
    parts: list[tuple[int, str, int, int]] = []  # level, title, start_line, body_start
    for idx, line in enumerate(lines):
        hm = HEADING_RE.match(line)
        if hm:
            parts.append((len(hm.group(1)), hm.group(2).strip(), idx, idx + 1))

    title = clean_title(parts[0][1], slug_title) if parts else clean_title("", slug_title)

    # Body of each heading is until the next heading
    sections_src = []
    for i, (level, heading, start, body_start) in enumerate(parts):
        end = parts[i + 1][2] if i + 1 < len(parts) else len(lines)
        body = "\n".join(lines[body_start:end]).rstrip()
        sections_src.append({"level": level, "heading": heading, "body": body, "kind": classify_heading(heading)})

    # Skip the H1 itself as a section; keep only its intro if any (usually empty)
    scenes: list[dict] = []
    current_scene: dict = {"title": "", "sections": []}
    skipping = False
    extra_notes: list[str] = []

    def ensure_scene() -> dict:
        nonlocal current_scene
        if current_scene is None:
            current_scene = {"title": "", "sections": []}
        return current_scene

    for sec in sections_src:
        kind = sec["kind"]
        heading = sec["heading"]
        body = sec["body"]
        if sec["level"] == 1 and heading == (parts[0][1] if parts else heading):
            # H1 body may contain intro text before the first subheading; ignore general archive instructions
            continue
        if kind == "skip":
            skipping = True
            continue
        if kind == "scene":
            skipping = False
            if current_scene["sections"] or current_scene["title"]:
                scenes.append(current_scene)
            scene_title = re.sub(r"^\d{4}-\d{2}-\d{2}\s*｜\s*", "", heading).strip()
            current_scene = {"title": scene_title, "sections": []}
            continue
        if skipping:
            continue

        body, trailing_note = extract_trailing_note(body)
        if trailing_note:
            extra_notes.append(trailing_note)

        section: dict = {"type": kind, "heading": heading}
        if kind == "qa":
            qa = parse_qa(body)
            section["items"] = qa["items"]
            section["supplements"] = qa["supplements"]
            section["preamble"] = qa["preamble"]
            section["text"] = body
        else:
            blocks = parse_blocks(body)
            section["blocks"] = blocks
            section["text"] = text_of_blocks(blocks)
        current_scene["sections"].append(section)

    if current_scene["sections"] or current_scene["title"]:
        scenes.append(current_scene)

    if extra_notes:
        # attach as a final note section on the last scene (or a new one)
        if not scenes:
            scenes.append({"title": "", "sections": []})
        scenes[-1]["sections"].append({
            "type": "note",
            "heading": "备注",
            "blocks": parse_blocks("\n\n".join(extra_notes)),
            "text": "\n\n".join(extra_notes),
        })

    # Flatten search text
    search_parts = [date, title, slug_title]
    for scene in scenes:
        if scene["title"]:
            search_parts.append(scene["title"])
        for section in scene["sections"]:
            search_parts.append(section.get("heading") or "")
            search_parts.append(section.get("text") or "")
            if section["type"] == "qa":
                for it in section.get("items") or []:
                    search_parts.extend(it.values())
                for sp in section.get("supplements") or []:
                    search_parts.extend(sp.values())

    return {
        "id": date,
        "date": date,
        "weekday": weekday_zh(date),
        "title": title,
        "filename": path.name,
        "slug": path.stem,
        "scenes": scenes,
        "search_text": "\n".join(p for p in search_parts if p),
    }


def build() -> dict:
    notes = []
    for path in sorted(NOTES_DIR.glob("*.md")):
        if path.name.lower() == "readme.md":
            continue
        parsed = parse_note_file(path)
        if parsed:
            notes.append(parsed)
    notes.sort(key=lambda n: n["date"], reverse=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(TZ_SHANGHAI).strftime("%Y-%m-%d %H:%M:%S %z"),
        "count": len(notes),
        "notes": notes,
    }
    (DATA_DIR / "notes.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return payload


def _debug_summary(payload: dict) -> None:
    print(f"Built {payload['count']} notes -> {DATA_DIR / 'notes.json'}")
    for note in payload["notes"]:
        types = []
        for scene in note["scenes"]:
            types.extend(s["type"] for s in scene["sections"])
        print(f"  {note['date']} {note['weekday']}  {note['title']}  sections={types}")


if __name__ == "__main__":
    _debug_summary(build())
