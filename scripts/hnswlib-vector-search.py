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
    print(f"ERROR: missing python dependency (hnswlib/numpy): {e}", file=sys.stderr)
    sys.exit(2)

try:
    import urllib.request
    import urllib.parse
    import urllib.error
except Exception:  # pragma: no cover
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


def fetch_indexable_rows(db_path: str, limit: int | None = None, doc_type: str | None = None):
    """Return rows from metadata_observations suitable for indexing, optionally filtered by doc_type.

    Schema assumed:
      id, sqlite_id, doc_type, field_type, document, project,
      platform_source, created_at_epoch
    """
    rows: list[dict] = []
    sql = (
        "SELECT id, sqlite_id, doc_type, field_type, document, project, "
        "platform_source, created_at_epoch FROM metadata_observations"
    )
    params: list[str] = []
    if doc_type:
        sql += " WHERE doc_type = ?"
        params.append(doc_type)
    sql += " ORDER BY created_at_epoch DESC"
    with _open_db(db_path) as con:
        cur = con.execute(sql, params)
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


def _vec_path(hnsw_dir: str) -> str:
    return os.path.join(hnsw_dir, "vectors.npy")


def _bin_path(hnsw_dir: str) -> str:
    return os.path.join(hnsw_dir, "index.bin")


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
    return {int(k): v for k, v in m.items()}


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


def cmd_build(args):
    db_path = args.db_path
    hnsw_dir = args.hnsw_dir
    dim = args.dim or EMBED_DIM
    limit = args.limit

    ensure_table(db_path)
    rows = fetch_indexable_rows(db_path, limit, doc_type='observation')
    doc_texts = [r.get("document", "") for r in rows]

    # Embed via Ollama. Fall back to random vectors when retriever is disabled
    # or Ollama is unreachable (keeps plugin alive during preflight).
    embeddings = []
    if RETRIEVE_EMBEDDING:
        for t in doc_texts:
            try:
                e = embed_one(t)
            except Exception:
                e = None
            embeddings.append(e)
    else:
        for _ in doc_texts:
            embeddings.append(np.random.default_rng(42).random(dim).tolist())

    # Keep only rows with a usable vector.
    kept = [
        (row, vec)
        for row, vec in zip(rows, embeddings)
        if vec is not None and len(vec) == dim
    ]
    if len(kept) < len(rows):
        print(
            f"INFO: dropped {len(rows)-len(kept)}/{len(rows)} rows "
            f"(missing/bad embedding); indexing {len(kept)}",
            file=sys.stderr,
        )

    if not kept:
        print(json.dumps({"built": False, "reason": "no indexable rows"}))
        return

    index = hnswlib.Index(space="cosine", dim=dim)
    index.init_index(
        max_elements=max(40, len(kept)),
        ef_construction=200,
        M=16,
        random_seed=42,
    )
    index.set_ef(40)

    by_label: dict[int, dict] = {}
    vecs: list[list[float]] = []
    for label, (row, vec) in enumerate(kept):
        by_label[label] = {
            "id": int(row["id"]),
            "sqlite_id": int(row["sqlite_id"]),
            "doc_type": row.get("doc_type"),
            "field_type": row.get("field_type"),
            "project": row.get("project"),
            "platform_source": row.get("platform_source"),
            "created_at_epoch": int(row["created_at_epoch"]) if row.get("created_at_epoch") is not None else 0,
        }
        vecs.append(vec)
    _build_index_in_memory(index, np.array(vecs, dtype=np.float32), list(range(len(kept))))

    # Persist as numpy arrays.  The native hnswlib Index.save_index is
    # unreliable across versions (sparse-index / Windows build), so we
    # round-trip the vectors and label map ourselves and rebuild the graph
    # on load.
    _save_vector_bin(hnsw_dir, np.array(vecs, dtype=np.float32))
    save_id_map(hnsw_dir, by_label)

    print(json.dumps(
        {"built": True, "elements": len(kept), "dim": dim}
    ))


def cmd_search(args):
    hnsw_dir = args.hnsw_dir
    query = args.query
    k = min(args.k or 20, 100)
    dim = args.dim or EMBED_DIM

    health = is_healthy(hnsw_dir, dim)
    if not health["ok"]:
        print(json.dumps({"results": [], "error": health["error"]}))
        return

    q = embed_one(query) if RETRIEVE_EMBEDDING else np.random.default_rng(0).random(dim).tolist()
    if q is None or len(q) != dim:
        print(json.dumps({"results": [], "error": "bad query embedding"}))
        return

    arr = _load_vector_bin(hnsw_dir)
    k = min(k, len(arr))  # k cannot exceed number of index elements
    index = hnswlib.Index(space="cosine", dim=dim)
    index.init_index(
        max_elements=max(40, len(arr)),
        ef_construction=200,
        M=16,
        random_seed=42,
    )
    index.set_ef(max(40, k))  # ef must be >= k for hnswlib knn_query to succeed
    _build_index_in_memory(index, arr, list(range(len(arr))))
    id_map = load_id_map(hnsw_dir)

    try:
        labelk, distk = index.knn_query(np.array([q], dtype=np.float32), k=k)
    except RuntimeError:
        if k > 1:
            try:
                k = max(1, k - 1)
                labelk, distk = index.knn_query(np.array([q], dtype=np.float32), k=k)
            except Exception as e2:
                print(json.dumps({"results": [], "error": f"hnswlib knn_query(k={k}): {e2}"}, ensure_ascii=False))
                return
        else:
            print(json.dumps({"results": [], "error": "hnswlib knn_query(k=1) failed"}, ensure_ascii=False))
            return
    out = []
    for rank, label in enumerate(labelk[0]):
        meta = id_map.get(int(label))
        if not meta:
            continue
        # cosine distance -> score (closer distance = higher score)
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

    print(json.dumps({"results": out}))


def cmd_health(args):
    print(json.dumps(is_healthy(args.hnsw_dir, args.dim or EMBED_DIM)))


def cmd_sync(args):
    ensure_table(args.db_path)
    row = json.loads(args.row)
    upsert_row(args.db_path, row)
    print(json.dumps({"synced": True, "id": row.get("id")}))


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
    syn.set_defaults(func=cmd_sync)

    a = p.parse_args()
    a.func(a)


if __name__ == "__main__":
    main()
