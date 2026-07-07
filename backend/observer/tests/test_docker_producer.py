from observer.producers.docker_ import (
    compute_cpu_pct,
    summarize_containers,
    translate_event,
)

PROJECT = "chorus"


def _event(action="die", name="chorus-chat-2", service="chat", project=PROJECT, **attrs):
    return {
        "Type": "container",
        "Action": action,
        "Actor": {"Attributes": {
            "name": name,
            "com.docker.compose.project": project,
            "com.docker.compose.service": service,
            **attrs,
        }},
    }


def test_translate_die_event():
    out = translate_event(_event(action="die", exitCode="137"), PROJECT)
    assert out == ("docker.event", "docker",
                   {"action": "die", "container": "chorus-chat-2",
                    "service": "chat", "exit_code": "137"})


def test_translate_filters_other_projects():
    assert translate_event(_event(project="somethingelse"), PROJECT) is None


def test_translate_ignores_non_container_events():
    assert translate_event({"Type": "network", "Action": "connect"}, PROJECT) is None


def test_translate_health_status_passthrough():
    out = translate_event(_event(action="health_status: unhealthy"), PROJECT)
    assert out[2]["action"] == "health_status: unhealthy"


def test_summarize_containers():
    raw = [{
        "Names": ["/chorus-redis-1"],
        "State": "running",
        "Status": "Up 3 minutes (healthy)",
        "Labels": {"com.docker.compose.project": PROJECT,
                   "com.docker.compose.service": "redis"},
    }, {
        "Names": ["/chorus-migrate-1"],
        "State": "exited",
        "Status": "Exited (0) 3 minutes ago",
        "Labels": {"com.docker.compose.project": PROJECT,
                   "com.docker.compose.service": "migrate"},
    }, {
        "Names": ["/unrelated"],
        "State": "running", "Status": "Up",
        "Labels": {},
    }]
    out = summarize_containers(raw, PROJECT)
    names = [c["name"] for c in out["containers"]]
    assert names == ["chorus-redis-1", "chorus-migrate-1"]     # third filtered out
    assert out["containers"][0]["health"] == "healthy"
    assert out["containers"][1]["health"] is None
    assert out["containers"][1]["state"] == "exited"


def test_cpu_pct_delta_formula():
    prev = {"cpu_stats": {"cpu_usage": {"total_usage": 100}, "system_cpu_usage": 1000,
                          "online_cpus": 4}}
    cur = {"cpu_stats": {"cpu_usage": {"total_usage": 200}, "system_cpu_usage": 2000,
                         "online_cpus": 4}}
    # (100 / 1000) * 4 * 100 = 40.0
    assert compute_cpu_pct(cur, prev) == 40.0


def test_cpu_pct_none_prev_is_zero():
    assert compute_cpu_pct({"cpu_stats": {}}, None) == 0.0
