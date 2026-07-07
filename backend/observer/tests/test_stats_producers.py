from observer.producers.pg_stats import build_payload as pg_payload
from observer.producers.redis_stats import build_payload as redis_payload


def test_redis_payload_shape():
    info = {"instantaneous_ops_per_sec": 12, "connected_clients": 9,
            "used_memory_human": "1.1M", "total_commands_processed": 5000}
    clients = [{"name": "chat", "addr": "10.0.0.5:5566", "cmd": "psubscribe"},
               {"name": "", "addr": "10.0.0.9:1234", "cmd": "client|list"}]
    out = redis_payload(info, clients, numpat=3, presence=[("7", 22), ("9", 30)])
    assert out["ops_per_sec"] == 12
    assert out["numpat"] == 3
    assert out["clients"][0]["name"] == "chat"
    assert out["presence"] == [{"user_id": 7, "ttl": 22}, {"user_id": 9, "ttl": 30}]


def test_pg_payload_deltas():
    stm_prev = {101: {"calls": 100, "total_exec_time": 50.0, "rows": 100, "query": "SELECT $1"}}
    stm_cur = {101: {"calls": 110, "total_exec_time": 60.0, "rows": 120, "query": "SELECT $1"},
               202: {"calls": 4, "total_exec_time": 2.0, "rows": 4, "query": "INSERT …"}}
    db_prev = {"xact_commit": 1000, "tup_inserted": 50, "blks_hit": 900, "blks_read": 100}
    db_cur = {"xact_commit": 1010, "tup_inserted": 55, "blks_hit": 990, "blks_read": 110}
    activity = {"connections": [{"app": "chat", "state": "idle", "n": 5}], "active": []}

    out = pg_payload(stm_prev, stm_cur, db_prev, db_cur, activity, interval_s=2.0)
    q101 = next(q for q in out["queries"] if q["query"] == "SELECT $1")
    assert q101["calls_per_s"] == 5.0                    # (110-100)/2
    assert q101["mean_ms"] == 1.0                        # (60-50)/(110-100)
    q202 = next(q for q in out["queries"] if q["query"].startswith("INSERT"))
    assert q202["calls_per_s"] == 2.0                    # new query: full counts
    assert out["commits_per_s"] == 5.0
    assert out["inserts_per_s"] == 2.5
    assert out["cache_hit_pct"] == 90.0                  # 90 hit / (90+10) read
    assert out["connections"] == [{"app": "chat", "state": "idle", "n": 5}]


def test_pg_payload_first_tick_zeros():
    out = pg_payload({}, {}, None, {"xact_commit": 5, "tup_inserted": 1,
                                    "blks_hit": 1, "blks_read": 1},
                     {"connections": [], "active": []}, interval_s=2.0)
    assert out["queries"] == []
    assert out["commits_per_s"] == 0.0
