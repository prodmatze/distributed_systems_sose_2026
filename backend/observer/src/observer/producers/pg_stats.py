"""Postgres stats poller.

Chorus queries finish in microseconds, so pg_stat_activity alone looks dead —
the continuously-moving signal is DELTAS of pg_stat_statements (per-query-shape
calls/s and mean ms) and pg_stat_database (commits/s, inserts/s, cache hit %).
Per-service attribution needs `application_name` set in shared/db.py's
connect_args — not done, so rows group under an empty app name.

pg_stat_statements requires shared_preload_libraries (compose command flag);
CREATE EXTENSION here is idempotent belt-and-suspenders and the statements
section degrades to [] gracefully when the extension is unavailable.
"""

import asyncio
import logging

import asyncpg

from observer.bus import Bus
from observer.settings import settings

logger = logging.getLogger("observer.producers.pg_stats")

_INTERVAL_S = 2.0
_TOP_N = 15


def build_payload(statements_prev: dict, statements_cur: dict,
                  db_prev: dict | None, db_cur: dict,
                  activity: dict, interval_s: float) -> dict:
    queries = []
    if statements_prev or statements_cur:
        for qid, cur in statements_cur.items():
            prev = statements_prev.get(qid, {"calls": 0, "total_exec_time": 0.0, "rows": 0})
            dc = cur["calls"] - prev["calls"]
            if dc <= 0:
                continue
            dt = cur["total_exec_time"] - prev["total_exec_time"]
            dr = cur["rows"] - prev["rows"]
            queries.append({
                "query": cur["query"],
                "calls_per_s": round(dc / interval_s, 2),
                "mean_ms": round(dt / dc, 3),
                "rows_per_s": round(dr / interval_s, 2),
            })
        queries.sort(key=lambda q: q["calls_per_s"], reverse=True)
        queries = queries[:_TOP_N]

    if db_prev is None:
        commits = inserts = 0.0
        hit_pct = 0.0
    else:
        commits = round((db_cur["xact_commit"] - db_prev["xact_commit"]) / interval_s, 2)
        inserts = round((db_cur["tup_inserted"] - db_prev["tup_inserted"]) / interval_s, 2)
        dh = db_cur["blks_hit"] - db_prev["blks_hit"]
        dr = db_cur["blks_read"] - db_prev["blks_read"]
        hit_pct = round(dh / (dh + dr) * 100.0, 1) if (dh + dr) > 0 else 100.0

    return {
        "queries": queries if db_prev is not None else [],
        "commits_per_s": commits,
        "inserts_per_s": inserts,
        "cache_hit_pct": hit_pct,
        "connections": activity["connections"],
        "active": activity["active"],
    }


async def _fetch_statements(conn) -> dict:
    try:
        rows = await conn.fetch(
            "SELECT queryid, calls, total_exec_time, rows, query FROM pg_stat_statements"
        )
    except (asyncpg.UndefinedTableError, asyncpg.PostgresError):
        return {}
    return {r["queryid"]: {"calls": r["calls"], "total_exec_time": r["total_exec_time"],
                           "rows": r["rows"], "query": r["query"]} for r in rows}


async def run_pg_stats(bus: Bus) -> None:
    pool = await asyncpg.create_pool(dsn=settings.database_url, min_size=1, max_size=2)
    try:
        async with pool.acquire() as conn:
            try:
                await conn.execute("CREATE EXTENSION IF NOT EXISTS pg_stat_statements")
            except asyncpg.PostgresError as exc:
                logger.warning("pg_stat_statements unavailable: %s", exc)

        stm_prev: dict = {}
        db_prev: dict | None = None
        while True:
            async with pool.acquire() as conn:
                stm_cur = await _fetch_statements(conn)
                db_row = await conn.fetchrow(
                    "SELECT xact_commit, tup_inserted, blks_hit, blks_read "
                    "FROM pg_stat_database WHERE datname = current_database()"
                )
                conn_rows = await conn.fetch(
                    "SELECT COALESCE(application_name,'') AS app, state, count(*) AS n "
                    "FROM pg_stat_activity WHERE datname = current_database() "
                    "GROUP BY 1, 2"
                )
                active_rows = await conn.fetch(
                    "SELECT COALESCE(application_name,'') AS app, query, "
                    "EXTRACT(EPOCH FROM (now() - query_start)) * 1000 AS ms "
                    "FROM pg_stat_activity "
                    "WHERE state = 'active' AND pid <> pg_backend_pid()"
                )
            db_cur = dict(db_row) if db_row else {"xact_commit": 0, "tup_inserted": 0,
                                                  "blks_hit": 0, "blks_read": 0}
            activity = {
                "connections": [{"app": r["app"], "state": r["state"], "n": r["n"]}
                                for r in conn_rows],
                "active": [{"app": r["app"], "query": r["query"],
                            "ms": round(float(r["ms"] or 0), 1)} for r in active_rows],
            }
            await bus.emit(type="db.stats", service="postgres",
                           payload=build_payload(stm_prev, stm_cur, db_prev, db_cur,
                                                 activity, _INTERVAL_S))
            stm_prev, db_prev = stm_cur, db_cur
            await asyncio.sleep(_INTERVAL_S)
    finally:
        await pool.close()
