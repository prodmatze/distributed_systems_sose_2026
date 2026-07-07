import json

from observer.producers.redis_tap import translate


def test_chat_message_translates():
    body = {"type": "message", "id": 7, "channel_id": 3, "sender_id": 1,
            "sender_username": "alice", "body": "hi", "created_at": "2026-07-07T18:00:00Z"}
    out = translate("chan:3", json.dumps(body), set())
    assert out == ("chat.message", "chat", {"channel_id": 3, "message": body})


def test_presence_set_new_user_goes_online():
    out = translate("__keyevent@0__:set", "presence:42", set())
    assert out == ("presence.online", "chat", {"user_id": 42})


def test_presence_set_known_user_is_silent_refresh():
    assert translate("__keyevent@0__:set", "presence:42", {42}) is None


def test_presence_expired_goes_offline():
    out = translate("__keyevent@0__:expired", "presence:42", {42})
    assert out == ("presence.offline", "chat", {"user_id": 42})


def test_presence_del_goes_offline():
    out = translate("__keyevent@0__:del", "presence:9", {9})
    assert out == ("presence.offline", "chat", {"user_id": 9})


def test_non_presence_keyevents_ignored():
    assert translate("__keyevent@0__:set", "somekey", set()) is None
    assert translate("__keyevent@0__:expired", "cache:1", set()) is None


def test_malformed_chat_payload_ignored():
    assert translate("chan:3", "not json", set()) is None
    assert translate("chan:notanint", "{}", set()) is None
