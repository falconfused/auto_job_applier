# Auto Job Applier — Foundation & Tailoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic, unit-testable core of the Auto Job Applier — project scaffold, typed config, SQLite application tracker, the ported `tectonic` resume-compile step, and the LLM-backed `tailor` + `rank` units — with no browser or live-network dependencies.

**Architecture:** A small Python package `ajapp/` with focused single-responsibility modules. All LLM access goes through one thin `ajapp/llm.py` seam so `tailor`/`rank` are pure functions that tests drive with a stubbed LLM. SQLite is the system of record; status transitions are explicit and one-directional.

**Tech Stack:** Python 3.10+, `pydantic` v2 (config/models), stdlib `sqlite3` (tracker), `openai` SDK (LLM seam, default model `gpt-4o`), `tectonic` (LaTeX→PDF, already used by `resume-automation`), `pytest` (tests). Package-managed with a `.venv` + `pyproject.toml`, mirroring the existing `resume-automation` layout.

This is Plan 1 of 4 for LinkedIn v1. Plans 2–4 (ingestion, Telegram bot, apply agent/scheduler) follow and depend on this foundation.

---

## File Structure

```
auto_job_applier/
  pyproject.toml                 # package + deps + pytest config
  .gitignore                     # venv, __pycache__, db, secrets, browser profile
  config/
    settings.yaml                # search filters, schedule, top-N, caps, paths
    settings.example.yaml        # committed template (real one gitignored)
    profile.json                 # ported personal/form-fill data
  ajapp/
    __init__.py
    paths.py                     # central path constants (repo root, data dirs)
    config.py                    # Settings + Profile pydantic models + loaders
    llm.py                       # complete_json(system, user) -> dict  (OpenAI seam)
    models.py                    # Posting, ScoredPosting, TailoredDocs dataclasses
    compile.py                   # ported: tectonic .tex -> PDF
    tailor.py                    # LLM: master .tex + JD + profile -> tailored .tex + cover letter
    rank.py                      # LLM: postings + resume/profile -> scored top-N
    tracker.py                   # SQLite: jobs, suggestions, applications, runs
  resume/
    master_resume.tex            # ported gold-copy master
  data/                          # applier.db lives here (gitignored)
  tests/
    conftest.py                  # fixtures: temp db, sample postings, fake llm
    test_config.py
    test_tracker.py
    test_compile.py
    test_tailor.py
    test_rank.py
    fixtures/
      sample_master_resume.tex
```

---

## Task 1: Project scaffold

**Files:**
- Create: `pyproject.toml`
- Create: `.gitignore`
- Create: `ajapp/__init__.py` (empty)
- Create: `ajapp/paths.py`
- Create: `tests/__init__.py` (empty)

- [ ] **Step 1: Write `pyproject.toml`**

```toml
[project]
name = "auto-job-applier"
version = "0.1.0"
description = "Autonomous LinkedIn job applier (LinkedIn v1)."
requires-python = ">=3.10"
dependencies = [
    "pydantic>=2.6",
    "pyyaml>=6.0",
    "openai>=1.30",
]

[project.optional-dependencies]
dev = ["pytest>=8.0"]

[tool.setuptools.packages.find]
where = ["."]
include = ["ajapp*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-q"
```

- [ ] **Step 2: Write `.gitignore`**

```gitignore
.venv/
__pycache__/
*.pyc
*.egg-info/
data/*.db
browser_profile/
config/settings.yaml
.env
resume/jobs/
output/
```

- [ ] **Step 3: Write `ajapp/paths.py`**

```python
"""Central filesystem paths. Everything resolves relative to the repo root."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
DATA_DIR = ROOT / "data"
RESUME_DIR = ROOT / "resume"
JOBS_DIR = RESUME_DIR / "jobs"
MASTER_RESUME = RESUME_DIR / "master_resume.tex"
SETTINGS_PATH = CONFIG_DIR / "settings.yaml"
PROFILE_PATH = CONFIG_DIR / "profile.json"
DB_PATH = DATA_DIR / "applier.db"


def ensure_dirs() -> None:
    for d in (DATA_DIR, RESUME_DIR, JOBS_DIR):
        d.mkdir(parents=True, exist_ok=True)
```

- [ ] **Step 4: Create empty `ajapp/__init__.py` and `tests/__init__.py`**

```bash
: > ajapp/__init__.py
: > tests/__init__.py
```

- [ ] **Step 5: Create venv and install**

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
```
Expected: installs pydantic, pyyaml, openai, pytest without error.

- [ ] **Step 6: Verify pytest runs (no tests yet)**

Run: `.venv/bin/pytest`
Expected: "no tests ran" (exit code 5) — confirms pytest is wired.

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml .gitignore ajapp/__init__.py ajapp/paths.py tests/__init__.py
git commit -m "chore: scaffold auto_job_applier package"
```

---

## Task 2: Ported master resume + compile

**Files:**
- Create: `resume/master_resume.tex` (copied from resume-automation)
- Create: `ajapp/compile.py`
- Create: `tests/fixtures/sample_master_resume.tex`
- Create: `tests/test_compile.py`

- [ ] **Step 1: Port the master resume**

```bash
cp /Users/apple/Desktop/resume-automation/templates/master_resume.tex resume/master_resume.tex
```
Expected: file exists and is non-empty (`wc -l resume/master_resume.tex` > 0).

- [ ] **Step 2: Create a tiny compilable fixture `tests/fixtures/sample_master_resume.tex`**

```latex
\documentclass{article}
\begin{document}
Hello Resume.
\end{document}
```

- [ ] **Step 3: Write the failing test `tests/test_compile.py`**

```python
import shutil
import pytest
from pathlib import Path
from ajapp import compile as comp

FIXTURE = Path(__file__).parent / "fixtures" / "sample_master_resume.tex"


@pytest.mark.skipif(shutil.which("tectonic") is None, reason="tectonic not installed")
def test_compile_pdf_produces_pdf(tmp_path):
    tex = tmp_path / "resume.tex"
    tex.write_text(FIXTURE.read_text(), encoding="utf-8")
    pdf = comp.compile_pdf(tex, tmp_path)
    assert pdf.exists()
    assert pdf.suffix == ".pdf"
    assert pdf.stat().st_size > 0


def test_compile_pdf_raises_without_tectonic(monkeypatch, tmp_path):
    monkeypatch.setattr(comp.shutil, "which", lambda _: None)
    tex = tmp_path / "resume.tex"
    tex.write_text("x", encoding="utf-8")
    with pytest.raises(comp.CompileError):
        comp.compile_pdf(tex, tmp_path)
```

- [ ] **Step 4: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_compile.py -v`
Expected: FAIL — `ModuleNotFoundError`/`AttributeError` (no `ajapp.compile`).

- [ ] **Step 5: Write `ajapp/compile.py`**

```python
"""Compile a .tex file to PDF using tectonic. Ported from resume-automation."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


class CompileError(RuntimeError):
    pass


def compile_pdf(tex_path: str | Path, out_dir: str | Path) -> Path:
    tex_path = Path(tex_path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    tectonic = shutil.which("tectonic")
    if not tectonic:
        raise CompileError("tectonic not found on PATH. Install via `brew install tectonic`.")

    result = subprocess.run(
        [tectonic, "-o", str(out_dir), str(tex_path)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise CompileError(
            f"tectonic failed (rc={result.returncode}):\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )

    pdf_path = out_dir / (tex_path.stem + ".pdf")
    if not pdf_path.exists():
        raise CompileError(f"PDF not produced at {pdf_path}")
    return pdf_path
```

- [ ] **Step 6: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_compile.py -v`
Expected: PASS (the tectonic test PASSES if installed, else SKIPS; the no-tectonic test PASSES).

- [ ] **Step 7: Commit**

```bash
git add resume/master_resume.tex ajapp/compile.py tests/fixtures/sample_master_resume.tex tests/test_compile.py
git commit -m "feat: port resume master + tectonic compile"
```

---

## Task 3: Domain models

**Files:**
- Create: `ajapp/models.py`

This task has no test of its own (pure data classes); it's exercised by later tasks. Keep it minimal.

- [ ] **Step 1: Write `ajapp/models.py`**

```python
"""Plain domain models passed between units."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ApplyType = Literal["easy_apply", "external"]


@dataclass
class Posting:
    """A raw job posting from ingestion."""
    linkedin_job_id: str
    title: str
    company: str
    location: str
    url: str
    apply_type: ApplyType
    jd_text: str = ""


@dataclass
class ScoredPosting:
    """A posting after LLM ranking."""
    posting: Posting
    fit_score: float          # 0..100
    fit_reason: str


@dataclass
class TailoredDocs:
    """Output of the tailor unit."""
    resume_tex: str
    cover_letter_tex: str
```

- [ ] **Step 2: Verify it imports**

Run: `.venv/bin/python -c "import ajapp.models; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add ajapp/models.py
git commit -m "feat: add domain models"
```

---

## Task 4: Config (Settings + Profile)

**Files:**
- Create: `config/settings.example.yaml`
- Create: `config/profile.json` (ported)
- Create: `ajapp/config.py`
- Create: `tests/test_config.py`

- [ ] **Step 1: Port the profile**

```bash
cp /Users/apple/Desktop/resume-automation/config/profile.json config/profile.json
```
Expected: file exists with the user's personal fields.

- [ ] **Step 2: Write `config/settings.example.yaml`**

```yaml
schedule:
  time: "20:00"            # local time, 24h
ranking:
  top_n: 10
search:
  filters:
    - keywords: "Software Development Engineer"
      location: "India"
      experience_level: "mid-senior"
      date_posted: "past-24h"
apply:
  daily_cap: 8
  easy_apply_only: true
llm:
  model: "gpt-4o"
telegram:
  chat_id: 0               # filled in by the user; token comes from env
```

- [ ] **Step 3: Write the failing test `tests/test_config.py`**

```python
import json
import pytest
from ajapp import config


def test_load_settings_parses_example(tmp_path):
    p = tmp_path / "settings.yaml"
    p.write_text(
        "schedule:\n  time: '20:00'\n"
        "ranking:\n  top_n: 5\n"
        "search:\n  filters:\n    - keywords: 'SDE'\n      location: 'India'\n"
        "apply:\n  daily_cap: 3\n  easy_apply_only: true\n"
        "llm:\n  model: 'gpt-4o'\n"
        "telegram:\n  chat_id: 42\n",
        encoding="utf-8",
    )
    s = config.load_settings(p)
    assert s.schedule.time == "20:00"
    assert s.ranking.top_n == 5
    assert s.search.filters[0].keywords == "SDE"
    assert s.apply.daily_cap == 3
    assert s.apply.easy_apply_only is True
    assert s.llm.model == "gpt-4o"
    assert s.telegram.chat_id == 42


def test_load_settings_rejects_bad_time(tmp_path):
    p = tmp_path / "settings.yaml"
    p.write_text(
        "schedule:\n  time: '8pm'\n"
        "ranking:\n  top_n: 5\n"
        "search:\n  filters: []\n"
        "apply:\n  daily_cap: 3\n  easy_apply_only: true\n"
        "llm:\n  model: 'gpt-4o'\n"
        "telegram:\n  chat_id: 42\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError):
        config.load_settings(p)


def test_load_profile(tmp_path):
    p = tmp_path / "profile.json"
    p.write_text(json.dumps({"name": "Vivek", "email": "v@x.com"}), encoding="utf-8")
    prof = config.load_profile(p)
    assert prof["name"] == "Vivek"
    assert prof["email"] == "v@x.com"
```

- [ ] **Step 4: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_config.py -v`
Expected: FAIL — no `ajapp.config`.

- [ ] **Step 5: Write `ajapp/config.py`**

```python
"""Typed config loading. Settings come from YAML; profile is a free-form dict."""
from __future__ import annotations

import json
import re
from pathlib import Path

import yaml
from pydantic import BaseModel, field_validator

from . import paths

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class Schedule(BaseModel):
    time: str

    @field_validator("time")
    @classmethod
    def _valid_time(cls, v: str) -> str:
        if not _TIME_RE.match(v):
            raise ValueError(f"schedule.time must be HH:MM 24h, got {v!r}")
        return v


class Ranking(BaseModel):
    top_n: int = 10


class SearchFilter(BaseModel):
    keywords: str
    location: str = ""
    experience_level: str = ""
    date_posted: str = ""
    min_ctc: float | None = None


class Search(BaseModel):
    filters: list[SearchFilter] = []


class Apply(BaseModel):
    daily_cap: int = 8
    easy_apply_only: bool = True


class Llm(BaseModel):
    model: str = "gpt-4o"


class Telegram(BaseModel):
    chat_id: int = 0


class Settings(BaseModel):
    schedule: Schedule
    ranking: Ranking
    search: Search
    apply: Apply
    llm: Llm
    telegram: Telegram


def load_settings(path: str | Path | None = None) -> Settings:
    path = Path(path) if path else paths.SETTINGS_PATH
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return Settings(**data)


def load_profile(path: str | Path | None = None) -> dict:
    path = Path(path) if path else paths.PROFILE_PATH
    return json.loads(path.read_text(encoding="utf-8"))
```

- [ ] **Step 6: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_config.py -v`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add config/settings.example.yaml config/profile.json ajapp/config.py tests/test_config.py
git commit -m "feat: typed settings + profile loading"
```

---

## Task 5: SQLite tracker

**Files:**
- Create: `ajapp/tracker.py`
- Create: `tests/conftest.py`
- Create: `tests/test_tracker.py`

- [ ] **Step 1: Write shared fixtures `tests/conftest.py`**

```python
import pytest
from ajapp import tracker
from ajapp.models import Posting


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "applier.db"
    tracker.init_db(path)
    return path


@pytest.fixture
def sample_posting():
    return Posting(
        linkedin_job_id="123",
        title="Backend Engineer",
        company="Acme",
        location="Bangalore",
        url="https://linkedin.com/jobs/view/123",
        apply_type="easy_apply",
        jd_text="Build APIs in Python.",
    )
```

- [ ] **Step 2: Write the failing test `tests/test_tracker.py`**

```python
import pytest
from ajapp import tracker


def test_add_job_is_idempotent_on_linkedin_id(db, sample_posting):
    id1 = tracker.add_job(sample_posting, db_path=db)
    id2 = tracker.add_job(sample_posting, db_path=db)
    assert id1 == id2  # same linkedin_job_id -> same row


def test_get_job_by_linkedin_id(db, sample_posting):
    tracker.add_job(sample_posting, db_path=db)
    row = tracker.get_job_by_linkedin_id("123", db_path=db)
    assert row["company"] == "Acme"
    assert row["apply_type"] == "easy_apply"


def test_create_application_and_transition(db, sample_posting):
    job_id = tracker.add_job(sample_posting, db_path=db)
    app_id = tracker.create_application(job_id, db_path=db)
    assert tracker.get_application(app_id, db_path=db)["status"] == "suggested"

    tracker.set_status(app_id, "tailoring", db_path=db)
    assert tracker.get_application(app_id, db_path=db)["status"] == "tailoring"


def test_set_status_rejects_unknown_status(db, sample_posting):
    job_id = tracker.add_job(sample_posting, db_path=db)
    app_id = tracker.create_application(job_id, db_path=db)
    with pytest.raises(ValueError):
        tracker.set_status(app_id, "banana", db_path=db)


def test_append_edit_note_accumulates(db, sample_posting):
    job_id = tracker.add_job(sample_posting, db_path=db)
    app_id = tracker.create_application(job_id, db_path=db)
    tracker.append_edit_note(app_id, "emphasize python", db_path=db)
    tracker.append_edit_note(app_id, "drop project X", db_path=db)
    notes = tracker.get_application(app_id, db_path=db)["edit_notes"]
    assert "emphasize python" in notes
    assert "drop project X" in notes


def test_record_run_counts(db):
    run_id = tracker.record_run(
        searched=3, found_new=5, suggested=5, status="ok", db_path=db
    )
    run = tracker.get_run(run_id, db_path=db)
    assert run["found_new"] == 5
    assert run["status"] == "ok"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_tracker.py -v`
Expected: FAIL — no `ajapp.tracker`.

- [ ] **Step 4: Write `ajapp/tracker.py`**

```python
"""SQLite system of record: jobs, suggestions, applications, runs.

Status flows one direction; callers transition explicitly via set_status().
Every function takes an optional db_path so tests can use a temp database.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path

from . import paths
from .models import Posting

VALID_STATUSES = {
    "suggested",
    "dismissed",
    "external_sent",
    "tailoring",
    "awaiting_submit",
    "cancelled",
    "applied",
    "failed",
}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    linkedin_job_id TEXT UNIQUE NOT NULL,
    title TEXT, company TEXT, location TEXT, url TEXT,
    apply_type TEXT NOT NULL,
    jd_text TEXT DEFAULT '',
    first_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    run_date TEXT NOT NULL,
    rank INTEGER, fit_score REAL, fit_reason TEXT
);
CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    status TEXT NOT NULL,
    resume_path TEXT, cover_letter_path TEXT,
    edit_notes TEXT DEFAULT '',
    applied_at TEXT, error TEXT,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    searched INTEGER, found_new INTEGER, suggested INTEGER,
    status TEXT, error TEXT
);
"""


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _connect(db_path: str | Path | None) -> sqlite3.Connection:
    path = Path(db_path) if db_path else paths.DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path: str | Path | None = None) -> None:
    with _connect(db_path) as conn:
        conn.executescript(_SCHEMA)


def add_job(posting: Posting, *, db_path: str | Path | None = None) -> int:
    with _connect(db_path) as conn:
        existing = conn.execute(
            "SELECT id FROM jobs WHERE linkedin_job_id = ?",
            (posting.linkedin_job_id,),
        ).fetchone()
        if existing:
            return existing["id"]
        cur = conn.execute(
            "INSERT INTO jobs (linkedin_job_id, title, company, location, url, "
            "apply_type, jd_text, first_seen) VALUES (?,?,?,?,?,?,?,?)",
            (
                posting.linkedin_job_id, posting.title, posting.company,
                posting.location, posting.url, posting.apply_type,
                posting.jd_text, _now(),
            ),
        )
        return cur.lastrowid


def get_job_by_linkedin_id(linkedin_job_id: str, *, db_path: str | Path | None = None) -> dict | None:
    with _connect(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM jobs WHERE linkedin_job_id = ?", (linkedin_job_id,)
        ).fetchone()
        return dict(row) if row else None


def create_application(job_id: int, *, db_path: str | Path | None = None) -> int:
    with _connect(db_path) as conn:
        cur = conn.execute(
            "INSERT INTO applications (job_id, status, updated_at) VALUES (?, 'suggested', ?)",
            (job_id, _now()),
        )
        return cur.lastrowid


def get_application(app_id: int, *, db_path: str | Path | None = None) -> dict | None:
    with _connect(db_path) as conn:
        row = conn.execute("SELECT * FROM applications WHERE id = ?", (app_id,)).fetchone()
        return dict(row) if row else None


def set_status(app_id: int, status: str, *, error: str | None = None,
               db_path: str | Path | None = None) -> None:
    if status not in VALID_STATUSES:
        raise ValueError(f"unknown status {status!r}; valid: {sorted(VALID_STATUSES)}")
    applied_at = _now() if status == "applied" else None
    with _connect(db_path) as conn:
        conn.execute(
            "UPDATE applications SET status = ?, error = COALESCE(?, error), "
            "applied_at = COALESCE(?, applied_at), updated_at = ? WHERE id = ?",
            (status, error, applied_at, _now(), app_id),
        )


def set_resume_paths(app_id: int, resume_path: str, cover_letter_path: str,
                     *, db_path: str | Path | None = None) -> None:
    with _connect(db_path) as conn:
        conn.execute(
            "UPDATE applications SET resume_path = ?, cover_letter_path = ?, updated_at = ? "
            "WHERE id = ?",
            (resume_path, cover_letter_path, _now(), app_id),
        )


def append_edit_note(app_id: int, note: str, *, db_path: str | Path | None = None) -> None:
    with _connect(db_path) as conn:
        row = conn.execute(
            "SELECT edit_notes FROM applications WHERE id = ?", (app_id,)
        ).fetchone()
        existing = (row["edit_notes"] or "") if row else ""
        combined = (existing + "\n" + note).strip() if existing else note
        conn.execute(
            "UPDATE applications SET edit_notes = ?, updated_at = ? WHERE id = ?",
            (combined, _now(), app_id),
        )


def add_suggestion(job_id: int, run_date: str, rank: int, fit_score: float,
                   fit_reason: str, *, db_path: str | Path | None = None) -> int:
    with _connect(db_path) as conn:
        cur = conn.execute(
            "INSERT INTO suggestions (job_id, run_date, rank, fit_score, fit_reason) "
            "VALUES (?,?,?,?,?)",
            (job_id, run_date, rank, fit_score, fit_reason),
        )
        return cur.lastrowid


def record_run(*, searched: int, found_new: int, suggested: int, status: str,
               error: str | None = None, db_path: str | Path | None = None) -> int:
    with _connect(db_path) as conn:
        cur = conn.execute(
            "INSERT INTO runs (date, searched, found_new, suggested, status, error) "
            "VALUES (?,?,?,?,?,?)",
            (_now(), searched, found_new, suggested, status, error),
        )
        return cur.lastrowid


def get_run(run_id: int, *, db_path: str | Path | None = None) -> dict | None:
    with _connect(db_path) as conn:
        row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        return dict(row) if row else None
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_tracker.py -v`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add ajapp/tracker.py tests/conftest.py tests/test_tracker.py
git commit -m "feat: sqlite application tracker"
```

---

## Task 6: LLM seam

**Files:**
- Create: `ajapp/llm.py`

The seam is intentionally tiny: one function that takes a system + user prompt and
returns parsed JSON. `tailor`/`rank` depend only on this, so tests monkeypatch it and
never hit the network. No test of its own (it's a thin wrapper over the OpenAI SDK).

- [ ] **Step 1: Write `ajapp/llm.py`**

```python
"""Thin LLM seam. The only place that talks to the model provider.

complete_json() asks the model to return JSON and parses it. Tailor/rank depend
on this function so tests can monkeypatch it and run offline.
"""
from __future__ import annotations

import json
import os

from openai import OpenAI

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    return _client


def complete_json(system: str, user: str, *, model: str = "gpt-4o") -> dict:
    """Return the model's reply parsed as JSON. Raises on invalid JSON."""
    resp = _get_client().chat.completions.create(
        model=model,
        temperature=0.4,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return json.loads(resp.choices[0].message.content)
```

- [ ] **Step 2: Verify import**

Run: `.venv/bin/python -c "import ajapp.llm; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add ajapp/llm.py
git commit -m "feat: add LLM seam (openai json)"
```

---

## Task 7: Rank unit

**Files:**
- Create: `ajapp/rank.py`
- Create: `tests/test_rank.py`

- [ ] **Step 1: Write the failing test `tests/test_rank.py`**

```python
from ajapp import rank
from ajapp.models import Posting


def _postings(n):
    return [
        Posting(
            linkedin_job_id=str(i), title=f"Job {i}", company="Acme",
            location="Bangalore", url=f"u{i}", apply_type="easy_apply",
            jd_text="python backend",
        )
        for i in range(n)
    ]


def test_rank_returns_top_n_sorted_desc(monkeypatch):
    # fake llm scores: job index i gets score i*10
    def fake_complete_json(system, user, *, model="gpt-4o"):
        return {
            "rankings": [
                {"linkedin_job_id": str(i), "fit_score": i * 10, "fit_reason": f"reason {i}"}
                for i in range(5)
            ]
        }
    monkeypatch.setattr(rank.llm, "complete_json", fake_complete_json)

    result = rank.rank(_postings(5), resume_text="x", profile={}, top_n=3, model="gpt-4o")

    assert len(result) == 3
    assert [r.posting.linkedin_job_id for r in result] == ["4", "3", "2"]
    assert result[0].fit_score == 40
    assert result[0].fit_reason == "reason 4"


def test_rank_ignores_unknown_ids_from_model(monkeypatch):
    def fake_complete_json(system, user, *, model="gpt-4o"):
        return {"rankings": [{"linkedin_job_id": "999", "fit_score": 99, "fit_reason": "ghost"}]}
    monkeypatch.setattr(rank.llm, "complete_json", fake_complete_json)

    result = rank.rank(_postings(2), resume_text="x", profile={}, top_n=5, model="gpt-4o")
    assert result == []  # 999 isn't among the real postings


def test_rank_empty_input_returns_empty(monkeypatch):
    monkeypatch.setattr(rank.llm, "complete_json", lambda *a, **k: {"rankings": []})
    assert rank.rank([], resume_text="x", profile={}, top_n=5, model="gpt-4o") == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_rank.py -v`
Expected: FAIL — no `ajapp.rank`.

- [ ] **Step 3: Write `ajapp/rank.py`**

```python
"""Rank postings against the user's resume/profile via the LLM seam."""
from __future__ import annotations

import json

from . import llm
from .models import Posting, ScoredPosting

_SYSTEM = (
    "You are a career-fit ranker. Given a candidate's resume/profile and a list of "
    "job postings, score each posting 0-100 for how well it fits the candidate and "
    "give a one-line reason. Respond ONLY as JSON: "
    '{"rankings": [{"linkedin_job_id": "<id>", "fit_score": <0-100>, "fit_reason": "<one line>"}]}'
)


def _build_user(postings: list[Posting], resume_text: str, profile: dict) -> str:
    jobs = [
        {
            "linkedin_job_id": p.linkedin_job_id,
            "title": p.title,
            "company": p.company,
            "location": p.location,
            "jd_text": p.jd_text,
        }
        for p in postings
    ]
    return json.dumps(
        {"resume": resume_text, "profile": profile, "postings": jobs}, ensure_ascii=False
    )


def rank(postings: list[Posting], *, resume_text: str, profile: dict,
         top_n: int, model: str = "gpt-4o") -> list[ScoredPosting]:
    if not postings:
        return []
    by_id = {p.linkedin_job_id: p for p in postings}
    data = llm.complete_json(_SYSTEM, _build_user(postings, resume_text, profile), model=model)

    scored: list[ScoredPosting] = []
    for r in data.get("rankings", []):
        posting = by_id.get(str(r.get("linkedin_job_id")))
        if posting is None:
            continue
        scored.append(
            ScoredPosting(
                posting=posting,
                fit_score=float(r.get("fit_score", 0)),
                fit_reason=str(r.get("fit_reason", "")),
            )
        )
    scored.sort(key=lambda s: s.fit_score, reverse=True)
    return scored[:top_n]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_rank.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add ajapp/rank.py tests/test_rank.py
git commit -m "feat: LLM ranking unit"
```

---

## Task 8: Tailor unit

**Files:**
- Create: `ajapp/tailor.py`
- Create: `tests/test_tailor.py`

- [ ] **Step 1: Write the failing test `tests/test_tailor.py`**

```python
from ajapp import tailor


def test_tailor_returns_resume_and_cover_letter(monkeypatch):
    def fake_complete_json(system, user, *, model="gpt-4o"):
        return {
            "resume_tex": "\\documentclass{article}\\begin{document}Tailored\\end{document}",
            "cover_letter_tex": "\\documentclass{article}\\begin{document}Dear\\end{document}",
        }
    monkeypatch.setattr(tailor.llm, "complete_json", fake_complete_json)

    docs = tailor.tailor(
        master_tex="MASTER", jd_text="Build APIs", profile={"name": "Vivek"},
        edit_notes="", model="gpt-4o",
    )
    assert "Tailored" in docs.resume_tex
    assert "Dear" in docs.cover_letter_tex


def test_tailor_includes_edit_notes_in_prompt(monkeypatch):
    captured = {}

    def fake_complete_json(system, user, *, model="gpt-4o"):
        captured["user"] = user
        return {"resume_tex": "x", "cover_letter_tex": "y"}
    monkeypatch.setattr(tailor.llm, "complete_json", fake_complete_json)

    tailor.tailor(
        master_tex="MASTER", jd_text="JD", profile={}, edit_notes="emphasize python",
        model="gpt-4o",
    )
    assert "emphasize python" in captured["user"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_tailor.py -v`
Expected: FAIL — no `ajapp.tailor`.

- [ ] **Step 3: Write `ajapp/tailor.py`**

```python
"""Tailor the master LaTeX resume + a cover letter to a specific JD via the LLM seam."""
from __future__ import annotations

import json

from . import llm
from .models import TailoredDocs

_SYSTEM = (
    "You are a resume tailor. You receive a LaTeX master resume, a job description, "
    "the candidate's profile, and optional edit instructions. Produce a tailored LaTeX "
    "resume (same document class/structure as the master, truthful — never invent "
    "experience) and a matching one-page LaTeX cover letter. Respond ONLY as JSON: "
    '{"resume_tex": "<full latex>", "cover_letter_tex": "<full latex>"}'
)


def _build_user(master_tex: str, jd_text: str, profile: dict, edit_notes: str) -> str:
    return json.dumps(
        {
            "master_resume_tex": master_tex,
            "jd_text": jd_text,
            "profile": profile,
            "edit_instructions": edit_notes,
        },
        ensure_ascii=False,
    )


def tailor(*, master_tex: str, jd_text: str, profile: dict, edit_notes: str = "",
           model: str = "gpt-4o") -> TailoredDocs:
    data = llm.complete_json(
        _SYSTEM, _build_user(master_tex, jd_text, profile, edit_notes), model=model
    )
    return TailoredDocs(
        resume_tex=data["resume_tex"],
        cover_letter_tex=data["cover_letter_tex"],
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_tailor.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite**

Run: `.venv/bin/pytest`
Expected: all tests pass (compile test may SKIP if tectonic absent).

- [ ] **Step 6: Commit**

```bash
git add ajapp/tailor.py tests/test_tailor.py
git commit -m "feat: LLM resume + cover-letter tailoring unit"
```

---

## Done criteria for Plan 1

- `.venv/bin/pytest` is green (compile test may skip without tectonic).
- `ajapp/` provides: typed config, SQLite tracker with explicit status transitions,
  tectonic compile, and offline-testable `rank` + `tailor` units behind one LLM seam.
- No browser, no Telegram, no live network in any test.
- Next: **Plan 2 — Ingestion** (Playwright + persistent LinkedIn profile, fixture-tested
  parsing) builds on `models.Posting` and `tracker.add_job`.

---

## Self-Review notes

- **Spec coverage:** Plan 1 covers spec §4 units `compile`, `tailor`, `rank`, `tracker`,
  config (§11), and domain models. Ingestion (§5.1), bot/gates (§5), apply agent (§5.6),
  scheduler + safety (§8) are deferred to Plans 2–4 — intentional decomposition.
- **Placeholders:** none — every code/test step has full content.
- **Type consistency:** `Posting`/`ScoredPosting`/`TailoredDocs` defined in Task 3 and used
  identically in `tracker` (Task 5), `rank` (Task 7), `tailor` (Task 8). `db_path`
  keyword-only arg is consistent across all tracker functions. `llm.complete_json(system,
  user, *, model)` signature is identical in the seam (Task 6) and both callers' fakes.
