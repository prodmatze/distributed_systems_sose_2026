from observer.producers.nginx_log import parse_line

LINE = ('{"ts":"2026-07-07T18:00:00+00:00","request_id":"abc123",'
        '"method":"POST","uri":"/auth/login","status":200,"bytes":180,'
        '"rt":"0.012","upstream":"172.18.0.5:8000","upstream_rt":"0.011",'
        '"remote":"172.18.0.1"}')


def test_parse_auth_request():
    out = parse_line(LINE)
    assert out is not None
    type_, service, payload, corr = out
    assert type_ == "http.request"
    assert service == "auth"
    assert corr == "abc123"
    assert payload["status"] == 200
    assert payload["method"] == "POST"
    assert payload["uri"] == "/auth/login"
    assert payload["rt_ms"] == 12.0
    assert payload["upstream"] == "172.18.0.5:8000"


def test_service_inference():
    for uri, svc in [("/api/channels", "api"), ("/ws?token=x", "chat"),
                     ("/ws/health", "chat"), ("/nothing", "gateway")]:
        line = LINE.replace("/auth/login", uri)
        assert parse_line(line)[1] == svc


def test_non_json_lines_skipped():
    assert parse_line("2026/07/07 18:00:00 [notice] 1#1: start worker") is None
    assert parse_line("") is None
