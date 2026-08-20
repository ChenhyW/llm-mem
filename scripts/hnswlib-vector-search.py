#!/usr/bin/env python3
"""
hnswlib-vector-search.py — hnswlib index builder + searcher for llm-mem.

The llm-mem worker (bun) spawns this Python helper to avoid needing a native
node-gyp binding. It uses the already-installed `hnswlib` and `numpy` Python
packages and an Ollama endpoint for 768-dim embeddings (nomic-embed-text).

Subcommands:
  build <db_path> <hnsw_dir> [--model DIM] [--limit N]
      Read rows from metadata_observations, embed via Ollama, build a
      persist-to-disk hnswlib.Index, write it to hnsw_dir/index.bin +
      hnsw_dir/id-map.json.
  search <hnsw_dir> <query> [--k K] [--model DIM]
      Embed <query> via Ollama, load the index, and return the top-K
      metadata_observations ids as JSON: [{"id": int, "sqlite_id": int,
      "doc_type": str, "score": float}, ...].
  health <hnsw_dir>
      Check that index.bin and id-map.json exist and are loadable.

Env:
  OLLAMA_URL   : Ollama base URL  (default http://127.0.0.1:11434)
  EMBED_MODEL  : embedding model   (default nomic-embed-text)
  EMBED_DIM    : expected vector dimension (default 768)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

try:
    import numpy as np
    import hnswlib
except Exception as e:  # pragma: no cover - defensive
    # Record a GLOBAL helper-unavailable status file so the worker preflight
    # (and the viewer diagnostics tab) can show "index build cannot run" with a
    # real reason, instead of leaving affected records as silent "未向量化".
    # Per-record vector-errors.json can't be written here: this failure happens
    # at module-load time, before cmd_build ever runs and before any sqlite_id
    # is known. This is a process-wide, all-or-nothing failure.
    import traceback as _tb
    _env = os.environ
    try:
        _home = (_env.get("HOME") or _env.get("USERPROFILE") or "")
        _data_dir = (_env.get("LLM_MEM_DATA_DIR") or "").strip()
        if _data_dir:
            if _data_dir.startswith("~"):
                _data_dir = os.path.join(_home, _data_dir[1:])
        else:
            _data_dir = os.path.join(_home, ".llm-mem")
        _hnsw_dir = os.path.join(_data_dir, "hnswlib")
        _trace = _tb.format_exc().strip().splitlines()
        _stderr_tail = _trace[-1] if _trace else None
        _payload = json.dumps({
            "reason": "missing python dependency (hnswlib/numpy): " + str(e),
            "stderr_tail": _stderr_tail,
            "recordedAtMs": int(time.time() * 1000),
        })
        try:
            os.makedirs(_hnsw_dir, exist_ok=True)
        except Exception:
            pass
        _status_path = os.path.join(_hnsw_dir, "hnswlib-helper-unavailable.json")
        with open(_status_path + ".tmp", "w", encoding="utf-8") as _f:
            _f.write(_payload)
        try:
            os.replace(_status_path + ".tmp", _status_path)
        except Exception:
            pass
    except Exception:
        pass
    print(f"ERROR: missing python dependency (hnswlib/numpy): {e}", file=sys.stderr)
    sys.exit(2)

try:
    import urllib.request
    import urllib.parse
    import urllib.error
except Exception:  # pragma: no cover
    pass


# Import succeeded — nuke any stale helper-unavailable marker so a previously
# broken interpreter does not linger as "index build cannot run" after the user
# fixed the deps. Cheap and idempotent.
try:
    _status = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
    _data = os.environ.get("LLM_MEM_DATA_DIR")
    if _data:
        _h = os.environ.get("HOME") or os.environ.get("USERPROFILE") or ""
        _data = os.path.join(_h, _data[1:]) if _data.startswith("~") else _data
    else:
        _data = os.path.join(os.environ.get("HOME") or os.environ.get("USERPROFILE") or "", ".llm-mem")
    _stale = os.path.join(_data, "hnswlib", "hnswlib-helper-unavailable.json")
    try:
        os.remove(_stale)
    except Exception:
        pass
except Exception:
    pass


OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "nomic-embed-text")
EMBED_DIM = int(os.environ.get("EMBED_DIM", "768"))
RETRIEVE_EMBEDDING = os.environ.get("RETRIEVE_EMBEDDING", "true").lower() in (
    "1",
    "true",
)


def _http(url: str, data: bytes, timeout: int = 120) -> bytes:
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def embed_one(text: str) -> list[float]:
    text = (text or "").strip()
    if not text:
        return [0.0] * EMBED_DIM
    payload = json.dumps(
        {"model": EMBED_MODEL, "input": [text], "truncate": True}
    ).encode("utf-8")
    body = _http(f"{OLLAMA_URL}/api/embed", payload)
    j = json.loads(body.decode("utf-8"))
    emb = j.get("embeddings") or j.get("embedding") or []
    if isinstance(emb, list) and emb and isinstance(emb[0], list):
        emb = emb[0]
    return [float(x) for x in emb]


# ── metadata_observations helpers (sqlite) ───────────────────────────────

try:
    import sqlite3
except Exception:  # pragma: no cover
    sqlite3 = None  # type: ignore[assignment]


def _open_db(db_path: str):
    if sqlite3 is None:
        raise RuntimeError("sqlite3 unavailable")
    return sqlite3.connect(db_path, timeout=60)


def fetch_indexable_rows(db_path: str, limit: int | None = None):
    """Return rows from metadata_observations suitable for indexing.

    Schema assumed:
      id, sqlite_id, doc_type, field_type, document, project,
      platform_source, created_at_epoch
    """
    rows: list[dict] = []
    with _open_db(db_path) as con:
        cur = con.execute(
            "SELECT id, sqlite_id, doc_type, field_type, document, project, "
            "platform_source, created_at_epoch FROM metadata_observations "
            "ORDER BY created_at_epoch DESC"
        )
        cols = [d[0] for d in cur.description]
        for r in cur:
            rows.append(dict(zip(cols, r)))
            if limit is not None and len(rows) >= limit:
                break
    return rows


def upsert_row(db_path: str, row: dict):
    """Insert or replace a single metadata_observations row."""
    with _open_db(db_path) as con:
        con.execute(
            "INSERT OR REPLACE INTO metadata_observations "
            "(id, sqlite_id, doc_type, field_type, document, project, "
            "platform_source, created_at_epoch) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                row.get("id"),
                row["sqlite_id"],
                row.get("doc_type"),
                row.get("field_type"),
                row.get("document"),
                row.get("project"),
                row.get("platform_source"),
                row.get("created_at_epoch"),
            ),
        )


def ensure_table(db_path: str):
    with _open_db(db_path) as con:
        con.execute(
            "CREATE TABLE IF NOT EXISTS metadata_observations ("
            "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
            "  sqlite_id INTEGER NOT NULL,"
            "  doc_type TEXT,"
            "  field_type TEXT,"
            "  document TEXT,"
            "  project TEXT,"
            "  platform_source TEXT,"
            "  created_at_epoch INTEGER"
            ")"
        )
        con.execute(
            "CREATE INDEX IF NOT EXISTS idx_meta_obs_sqlite_id "
            "ON metadata_observations(sqlite_id)"
        )


# ── index persistence ────────────────────────────────────────────────────

def _id_map_path(hnsw_dir: str) -> str:
    return os.path.join(hnsw_dir, "id-map.json")


def _errors_path(hnsw_dir: str) -> str:
    return os.path.join(hnsw_dir, "vector-errors.json")


def _read_errors(hnsw_dir: str) -> dict[int, str]:
    p = _errors_path(hnsw_dir)
    if not os.path.exists(p):
        return {}
    try:
        with open(p) as f:
            m = json.load(f)
        return {int(k): str(v) for k, v in m.items()}
    except Exception:
        return {}


def _save_errors(hnsw_dir: str, by_sqlite_id: dict[int, str]) -> None:
    os.makedirs(hnsw_dir, exist_ok=True)
    payload = {str(k): v for k, v in by_sqlite_id.items()}
    tmp = _errors_path(hnsw_dir) + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f)
    os.replace(tmp, _errors_path(hnsw_dir))


def record_vector_error(hnsw_dir: str, sqlite_id: int, error: str) -> None:
    """Persist a per-record vectorization failure reason so the viewer can show
    the concrete cause (e.g. 'Ollama unreachable') instead of a generic badge."""
    errors = _read_errors(hnsw_dir)
    errors[int(sqlite_id)] = str(error)
    _save_errors(hnsw_dir, errors)


def clear_vector_error(hnsw_dir: str, sqlite_id: int) -> None:
    """Drop a per-record error once that record is (re)vectorized successfully."""
    errors = _read_errors(hnsw_dir)
    errors.pop(int(sqlite_id), None)
    _save_errors(hnsw_dir, errors)


def _progress_path(hnsw_dir: str) -> str:
    return os.path.join(hnsw_dir, "build-progress.json")


def write_build_progress(hnsw_dir: str, processed: int, total: int, rebuilt: int, skipped: int, failed: int, errors: list[str]) -> None:
    """Write a lightweight progress file so the worker can report live progress
    during a rebuild.  Cheap JSON (a few ints) — unlike the full id-map, this is
    safe to write on every row."""
    try:
        tmp = _progress_path(hnsw_dir) + ".tmp"
        with open(tmp, "w") as f:
            json.dump(
                {
                    "processed": processed,
                    "total": total,
                    "rebuilt": rebuilt,
                    "skipped": skipped,
                    "failed": failed,
                    "errors": errors[:5],
                },
                f,
            )
        os.replace(tmp, _progress_path(hnsw_dir))
    except Exception:
        pass  # progress reporting is best-effort


def clear_build_progress(hnsw_dir: str) -> None:
    try:
        p = _progress_path(hnsw_dir)
        if os.path.exists(p):
            os.remove(p)
    except Exception:
        pass


def _vec_path(hnsw_dir: str) -> str:
    return os.path.join(hnsw_dir, "vectors.npy")


def _bin_path(hnsw_dir: str) -> str:
    return os.path.join(hnsw_dir, "index.bin")


def _infer_dim(hnsw_dir: str) -> int:
    """Return the dimension of the existing on-disk index, or 0 if none."""
    vp = _vec_path(hnsw_dir)
    mp = _id_map_path(hnsw_dir)
    if not (os.path.exists(vp) and os.path.exists(mp)):
        return 0
    try:
        m = load_id_map(hnsw_dir)
        n = len(m)
        data = open(vp, "rb").read()
        arr = np.frombuffer(data, dtype=np.float32)
        if n == 0 or arr.size == 0:
            return 0
        return int(arr.size // n)
    except Exception:
        return 0


def _pick_dim(hnsw_dir: str) -> int:
    """Return the actual dimension of the existing index, or 0 if none."""
    return _infer_dim(hnsw_dir)


def _save_vector_bin(hnsw_dir: str, arr: np.ndarray) -> None:
    os.makedirs(hnsw_dir, exist_ok=True)
    final = _vec_path(hnsw_dir)
    p = final + ".tmp"
    # Write the raw bytes ourselves rather than np.save: passing a path that
    # does not already end in ".npy" causes numpy to append ".npy" itself
    # (vectors.npy.tmp -> vectors.npy.tmp.npy), which silently corrupts the
    # tmp/replace flow.
    data = arr.tobytes()
    with open(p, "wb") as f:
        f.write(data)
    os.replace(p, final)


def _load_vector_bin(hnsw_dir: str) -> np.ndarray:
    m = load_id_map(hnsw_dir)
    n = len(m)
    data = open(_vec_path(hnsw_dir), "rb").read()
    arr = np.frombuffer(data, dtype=np.float32).reshape((n, -1))
    return arr


def _build_index_in_memory(
    index: hnswlib.Index,
    arr: np.ndarray,
    labels: list[int],
) -> None:
    """Build the hnswlib graph in memory from a numpy vector array."""
    index.add_items(arr, labels)


def save_id_map(hnsw_dir: str, by_label: dict[int, dict]):
    os.makedirs(hnsw_dir, exist_ok=True)
    payload = {str(k): v for k, v in by_label.items()}
    tmp = _id_map_path(hnsw_dir) + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f)
    os.replace(tmp, _id_map_path(hnsw_dir))


def load_id_map(hnsw_dir: str) -> dict[int, dict]:
    p = _id_map_path(hnsw_dir)
    with open(p) as f:
        m = json.load(f)
    result = {}
    for k, v in m.items():
        if v.get("status") == "failed":
            continue
        entry = dict(v)
        entry.pop("status", None)
        entry.pop("vector_error", None)
        result[int(k)] = entry
    return result


def _rebuild_index_on_disk(hnsw_dir: str, vecs: np.ndarray, meta_map: dict[int, dict]) -> None:
    """Save vectors + id-map, then rebuild the in-memory hnsw graph (sanity)."""
    _save_vector_bin(hnsw_dir, vecs)
    save_id_map(hnsw_dir, meta_map)
    # Rebuild graph in-memory to ensure the persisted index is healthy.
    index = hnswlib.Index(space="cosine", dim=vecs.shape[1])
    index.init_index(
        max_elements=max(40, len(vecs) + 10000),
        ef_construction=200,
        M=16,
        random_seed=42,
    )
    index.set_ef(40)
    _build_index_in_memory(index, vecs, list(range(len(vecs))))


def append_vector_to_index(
    hnsw_dir: str,
    meta: dict,
    vec: np.ndarray,
) -> None:
    """Append a single vector + metadata entry to the hnsw index on disk.

    Strategy: load existing vectors.npy + id-map, append one row, then
    _rebuild_index_on_disk the whole thing.  Full rebuild of a 247-element
    index is negligible (~5ms) compared with the Ollama embed call, and it
    keeps id-map labels contiguous (0..N-1) so the search path never breaks.
    """
    os.makedirs(hnsw_dir, exist_ok=True)

    # Load existing state.  If no index yet, start fresh.
    id_map_exists = os.path.exists(_id_map_path(hnsw_dir))
    vecs_exist = os.path.exists(_vec_path(hnsw_dir))
    if id_map_exists and vecs_exist:
        meta_map = load_id_map(hnsw_dir)
        existing_vecs = _load_vector_bin(hnsw_dir)
        # Re-dimension in case the new vector has a different dim (e.g. model change).
        if existing_vecs.shape[1] != vec.shape[0]:
            existing_vecs = np.full(
                (existing_vecs.shape[0], vec.shape[0]), 0.0, dtype=np.float32
            )
        new_label = len(meta_map)
    else:
        meta_map = {}
        existing_vecs = np.empty((0, vec.shape[0]), dtype=np.float32)
        new_label = 0

    # Store metadata for the new element.
    meta = dict(meta)
    meta["embed_model"] = EMBED_MODEL
    meta_map[new_label] = meta

    # Append the vector.
    new_vecs = np.vstack([existing_vecs, vec])

    _rebuild_index_on_disk(hnsw_dir, new_vecs, meta_map)


def is_healthy(hnsw_dir: str, dim: int = EMBED_DIM) -> dict:
    vecp = _vec_path(hnsw_dir)
    mapp = _id_map_path(hnsw_dir)
    missing = [p for p in [vecp, mapp] if not os.path.exists(p)]
    if missing:
        return {"ok": False, "error": f"missing {missing}"}
    try:
        arr = _load_vector_bin(hnsw_dir)
        m = load_id_map(hnsw_dir)
        index = hnswlib.Index(space="cosine", dim=dim)
        index.init_index(
            max_elements=max(40, len(arr)),
            ef_construction=200,
            M=16,
            random_seed=42,
        )
        index.set_ef(40)
        _build_index_in_memory(index, arr, list(range(len(arr))))
        return {
            "ok": True,
            "dim": dim,
            "num_elements": len(arr),
            "id_map_len": len(m),
        }
    except Exception as e:
        return {"ok": False, "error": repr(e)}


def _try_embed(row: dict, hnsw_dir: str) -> list[float] | None:
    """Embed a single row's document text. Returns None on failure."""
    text = row.get("document", "")
    if RETRIEVE_EMBEDDING:
        try:
            vec = embed_one(text)
            return vec if vec is not None else None
        except Exception:
            return None
    else:
        dim = _pick_dim(hnsw_dir) or EMBED_DIM
        return np.random.default_rng(42).random(dim).tolist()


def cmd_build(args):
    db_path = args.db_path
    hnsw_dir = args.hnsw_dir
    limit = args.limit

    ensure_table(db_path)
    rows = fetch_indexable_rows(db_path, limit)

    # Load existing id-map + vectors for incremental comparison
    os.makedirs(hnsw_dir, exist_ok=True)
    old_id_map: dict[str, dict] = {}
    try:
        with open(_id_map_path(hnsw_dir)) as f:
            old_id_map = json.load(f)
    except Exception:
        pass

    # old label -> vector (only for non-failed entries)
    old_label_vecs: dict[int, list[float]] = {}
    if os.path.exists(_vec_path(hnsw_dir)) and old_id_map:
        try:
            old_arr = _load_vector_bin(hnsw_dir)
            for k, v in old_id_map.items():
                lbl = int(k)
                if lbl < len(old_arr) and v.get("status") != "failed":
                    old_label_vecs[lbl] = old_arr[lbl].tolist()
        except Exception:
            pass

    # db_id -> (old_label, old_entry) for quick lookup
    # Key on sqlite_id (stable) rather than the SQLite row `id` (changes when
    # records are deleted), so id-map entries still match after deletions.
    old_by_db_id: dict[int, tuple[int, dict]] = {}
    for k, v in old_id_map.items():
        if isinstance(v, dict) and "sqlite_id" in v:
            old_by_db_id[int(v["sqlite_id"])] = (int(k), v)

    # ── Phase 1: incremental embed (write lightweight progress per row) ──
    by_label: dict[int, dict] = {}
    new_vecs: list[list[float]] = []   # vectors for newly embedded rows (in order)
    need_rebuild = 0
    skipped = 0
    failed_count = 0
    errors: list[str] = []
    total = len(rows)

    # Write initial progress immediately so the frontend sees 0/total instead of
    # stale data from a previous build's id-map.
    write_build_progress(hnsw_dir, 0, total, 0, 0, 0, [])

    for label, row in enumerate(rows):
        db_id = int(row["sqlite_id"])
        meta: dict = {
            "id": db_id,
            "sqlite_id": int(row["sqlite_id"]),
            "doc_type": row.get("doc_type"),
            "field_type": row.get("field_type"),
            "project": row.get("project"),
            "platform_source": row.get("platform_source"),
            "created_at_epoch": int(row["created_at_epoch"]) if row.get("created_at_epoch") is not None else 0,
            "embed_model": EMBED_MODEL,
        }
        old_lookup = old_by_db_id.get(db_id)
        old_entry = old_lookup[1] if old_lookup is not None else None

        # Check if we can skip (exists, not failed, same model)
        if (old_entry is not None
            and old_entry.get("status") != "failed"
            and old_entry.get("embed_model") == EMBED_MODEL):
            # Reuse old entry + old vector
            by_label[label] = meta
            old_lbl = old_lookup[0]
            if old_lbl in old_label_vecs:
                new_vecs.append(old_label_vecs[old_lbl])
            else:
                # Vector missing on disk - must re-embed
                need_rebuild += 1
                vec = _try_embed(row, hnsw_dir)
                if vec is not None:
                    meta["status"] = "vectorized"
                    new_vecs.append(vec)
                else:
                    meta["status"] = "failed"
                    meta["vector_error"] = "re-embed (vector missing on disk) returned None"
                    failed_count += 1
                    errors.append(meta["vector_error"])
                by_label[label] = meta
            skipped += 1
            write_build_progress(hnsw_dir, label + 1, total, need_rebuild, skipped, failed_count, errors)
            continue

        # Need to (re)embed this row
        need_rebuild += 1
        vec = _try_embed(row, hnsw_dir)
        if vec is not None:
            meta["status"] = "vectorized"
            new_vecs.append(vec)
        else:
            meta["status"] = "failed"
            meta["vector_error"] = "embed returned None or failed"
            failed_count += 1
            errors.append(meta["vector_error"])
        by_label[label] = meta
        write_build_progress(hnsw_dir, label + 1, total, need_rebuild, skipped, failed_count, errors)

    # ── Phase 2: build hnsw index from vectorized entries ──
    final_vecs: list[list[float]] = []
    final_labels: list[int] = []
    final_id_map: dict[int, dict] = {}
    new_label = 0
    vec_iter = iter(new_vecs)

    for label, entry in by_label.items():
        if entry.get("status") == "failed":
            final_id_map[new_label] = entry
            new_label += 1
            continue
        try:
            vec = next(vec_iter)
        except StopIteration:
            continue
        clean_entry = dict(entry)
        clean_entry.pop("status", None)
        clean_entry.pop("vector_error", None)
        final_id_map[new_label] = clean_entry
        final_vecs.append(vec)
        final_labels.append(new_label)
        new_label += 1

    if not final_vecs:
        clear_build_progress(hnsw_dir)
        print(json.dumps({"built": False, "reason": "no vectorized rows", "total": len(rows)}))
        return

    dim = len(final_vecs[0])
    index = hnswlib.Index(space="cosine", dim=dim)
    index.init_index(
        max_elements=max(40, len(final_vecs)),
        ef_construction=200,
        M=16,
        random_seed=42,
    )
    index.set_ef(40)
    _build_index_in_memory(index, np.array(final_vecs, dtype=np.float32), final_labels)

    _save_vector_bin(hnsw_dir, np.array(final_vecs, dtype=np.float32))
    save_id_map(hnsw_dir, final_id_map)
    clear_build_progress(hnsw_dir)
    print(json.dumps(
        {"built": True, "elements": len(final_vecs), "dim": dim, "total": len(rows), "failed": failed_count, "rebuilt": need_rebuild, "skipped": skipped}
    ))


def cmd_search(args):
    hnsw_dir = args.hnsw_dir
    query = args.query
    k = min(args.k or 20, 100)
    dim = _pick_dim(hnsw_dir)

    if dim <= 0:
        print(json.dumps({"results": [], "error": "no index found to infer dimension"}))
        return

    health = is_healthy(hnsw_dir, dim)
    if not health["ok"]:
        print(json.dumps({"results": [], "error": health["error"]}))
        return

    q = embed_one(query) if RETRIEVE_EMBEDDING else np.random.default_rng(0).random(dim).tolist()
    if q is None or len(q) != dim:
        print(json.dumps({"results": [], "error": "bad query embedding"}))
        return

    arr = _load_vector_bin(hnsw_dir)
    k = min(k, len(arr))
    index = hnswlib.Index(space="cosine", dim=dim)
    index.init_index(
        max_elements=max(40, len(arr)),
        ef_construction=200,
        M=16,
        random_seed=42,
    )
    index.set_ef(40)
    _build_index_in_memory(index, arr, list(range(len(arr))))
    id_map = load_id_map(hnsw_dir)

    labelk, distk = index.knn_query(np.array([q], dtype=np.float32), k=k)
    out = []
    for rank, label in enumerate(labelk[0]):
        meta = id_map.get(int(label))
        if not meta:
            continue
        distance = float(distk[0][rank])
        score = round(float(1.0 - distance), 4)
        out.append(
            {
                "sqlite_id": meta["sqlite_id"],
                "doc_type": meta["doc_type"],
                "score": score,
                "meta": meta,
            }
        )

    print(json.dumps({"results": out, "dim": dim}))


def cmd_health(args):
    dim = _pick_dim(args.hnsw_dir) or EMBED_DIM
    print(json.dumps(is_healthy(args.hnsw_dir, dim)))


def cmd_sync(args):
    """Write a row into metadata_observations and append its embedding to the
    hnsw index.

    Embedding is done *here* so a fresh observation is searchable immediately;
    we never need a full rebuild except when the user explicitly requests it
    (e.g. after changing the embedding model).
    """
    hnsw_dir = getattr(args, "hnsw_dir", None)
    ensure_table(args.db_path)
    row = json.loads(args.row)
    upsert_row(args.db_path, row)
    out = {"synced": True, "id": row.get("id")}

    if hnsw_dir:
        text = row.get("document", "")
        try:
            vec = embed_one(text)
            expected_dim = _pick_dim(hnsw_dir)
            # If there's no existing index yet, accept whatever dim the model returns.
            if vec is None or (expected_dim > 0 and len(vec) != expected_dim):
                out["vectorized"] = False
                out["vector_error"] = (
                    f"bad embedding length {len(vec or [])} vs expected dim {expected_dim}"
                )
                record_vector_error(hnsw_dir, int(row["sqlite_id"]), out["vector_error"])
            else:
                meta = {
                    "id": int(row.get("id", 0)),
                    "sqlite_id": int(row["sqlite_id"]),
                    "doc_type": row.get("doc_type"),
                    "field_type": row.get("field_type"),
                    "project": row.get("project"),
                    "platform_source": row.get("platform_source"),
                    "created_at_epoch": int(row.get("created_at_epoch") or 0),
                }
                append_vector_to_index(hnsw_dir, meta, np.array(vec, dtype=np.float32))
                clear_vector_error(hnsw_dir, int(row["sqlite_id"]))
                out["vectorized"] = True
        except Exception as e:
            out["vectorized"] = False
            out["vector_error"] = repr(e)
            record_vector_error(hnsw_dir, int(row["sqlite_id"]), out["vector_error"])

    print(json.dumps(out))


def main():
    p = argparse.ArgumentParser(prog="hnswlib-vector-search.py")
    sub = p.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build")
    b.add_argument("db_path")
    b.add_argument("hnsw_dir")
    b.add_argument("--dim", type=int, default=None)
    b.add_argument("--limit", type=int, default=None)
    b.set_defaults(func=cmd_build)

    s = sub.add_parser("search")
    s.add_argument("hnsw_dir")
    s.add_argument("query")
    s.add_argument("--k", type=int, default=None)
    s.add_argument("--dim", type=int, default=None)
    s.set_defaults(func=cmd_search)

    h = sub.add_parser("health")
    h.add_argument("hnsw_dir")
    h.add_argument("--dim", type=int, default=None)
    h.set_defaults(func=cmd_health)

    syn = sub.add_parser("sync")
    syn.add_argument("db_path")
    syn.add_argument("--row", required=True)
    syn.add_argument("--hnsw-dir", default=None)
    syn.set_defaults(func=cmd_sync)

    a = p.parse_args()
    a.func(a)


if __name__ == "__main__":
    main()
