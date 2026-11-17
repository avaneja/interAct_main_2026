"""Delivery and focus: how answers were given, never part of the score."""

import pytest
from sqlalchemy import select

from app.models import Answer
from app.schemas import DeliverySignals
from app.services.delivery import NOTE, count_fillers, delivery_record, summarise

ANSWER = "Um, a process is, you know, a running program with its own memory " * 2


def signals(**overrides):
    data = {"answer_seconds": 30, "spoken": True}
    return DeliverySignals.model_validate({**data, **overrides})


@pytest.mark.parametrize("text, fillers", [
    ("Um, uh, I mean it is a queue.", 3),
    ("It is, you know, sort of a stack.", 2),
    ("I would like a stack; actually it is basically a list.", 0),  # Real words, not fillers.
    ("The umbrella is under the hum.", 0),
])
def test_only_unambiguous_fillers_are_counted(text, fillers):
    assert count_fillers(text) == fillers


def test_a_spoken_answer_gets_words_fillers_and_pace():
    record = delivery_record(ANSWER, signals(answer_seconds=12))

    assert record["words"] == 26
    assert record["filler_words"] == 4
    assert record["words_per_minute"] == 130
    assert record["spoken"] is True


@pytest.mark.parametrize("overrides", [{"spoken": False}, {"answer_seconds": 3}])
def test_pace_is_left_out_for_typed_or_very_short_answers(overrides):
    assert delivery_record(ANSWER, signals(**overrides))["words_per_minute"] is None


@pytest.mark.parametrize("bad", [
    {"answer_seconds": -1},
    {"tab_switches": -2},
    {"camera": {"looking_away_ratio": 1.5, "look_aways": 0, "face_missing_ratio": 0, "multiple_faces_ratio": 0}},
    {"video": "data:video/webm;base64,AAAA"},  # Media is never accepted.
    {"camera": {"looking_away_ratio": 0, "look_aways": 0, "face_missing_ratio": 0, "multiple_faces_ratio": 0,
                "frame": "base64image"}},
])
def test_only_bounded_numbers_are_accepted(bad):
    with pytest.raises(ValueError):
        signals(**bad)


def camera(away, missing=0.0, many=0.0, look_aways=1):
    return {"looking_away_ratio": away, "look_aways": look_aways, "face_missing_ratio": missing,
            "multiple_faces_ratio": many}


def test_the_summary_totals_answers_and_weights_camera_estimates_by_time():
    records = [
        delivery_record("Um a queue is first in first out " * 3, signals(answer_seconds=20, tab_switches=1,
                        seconds_away=4, camera=camera(0.1, look_aways=2))),
        delivery_record("A stack is last in first out " * 3, signals(answer_seconds=60, camera=camera(0.5, missing=0.25))),
        delivery_record("Typed answer here.", signals(answer_seconds=40, spoken=False, fullscreen_exits=1)),
    ]

    summary = summarise(records)

    assert summary["answers_measured"] == 3
    assert summary["speaking_seconds"] == 120
    assert summary["words_per_minute"] == round((24 + 21) / (80 / 60))  # Spoken answers only.
    assert summary["filler_words"] == 3
    assert (summary["tab_switches"], summary["seconds_away"], summary["fullscreen_exits"]) == (1, 4, 1)
    assert summary["camera"] == {"answers": 2, "looking_away_ratio": 0.4, "look_aways": 3,
                                 "face_missing_ratio": 0.19, "multiple_faces_ratio": 0.0}
    assert summary["note"] == NOTE


def test_no_measurements_means_no_section():
    assert summarise([]) is None


def test_no_camera_means_no_camera_estimates():
    assert summarise([delivery_record(ANSWER, signals())])["camera"] is None


# Through the API


def started(client):
    sid = client.post("/api/v1/sessions", json={"input_model": "TOPIC"}).json()["id"]
    client.put(f"/api/v1/sessions/{sid}/context",
               json={"input_model": "TOPIC", "topic": "Data structures", "subtopics": ["queues"]})
    client.put(f"/api/v1/sessions/{sid}/config",
               json={"question_type": "DIRECT", "difficulty": "beginner", "question_count": 5})
    client.post(f"/api/v1/sessions/{sid}/confirm")
    return sid, client.post(f"/api/v1/sessions/{sid}/start").json()


def test_answers_carry_their_delivery_into_the_report_but_not_the_score(client, db_engine):
    sid, question = started(client)
    plain_sid, plain_question = started(client)
    delivery = {"answer_seconds": 30, "spoken": True, "tab_switches": 2, "seconds_away": 5,
                "camera": camera(0.3)}

    client.post(f"/api/v1/sessions/{sid}/answers",
                json={"question_id": question["id"], "text": ANSWER, "delivery": delivery})
    client.post(f"/api/v1/sessions/{plain_sid}/answers", json={"question_id": plain_question["id"], "text": ANSWER})
    client.post(f"/api/v1/sessions/{sid}/finish")
    client.post(f"/api/v1/sessions/{plain_sid}/finish")

    report = client.get(f"/api/v1/sessions/{sid}/report").json()["summary"]
    plain = client.get(f"/api/v1/sessions/{plain_sid}/report").json()["summary"]
    assert report["delivery"]["tab_switches"] == 2
    assert report["delivery"]["camera"]["looking_away_ratio"] == 0.3
    assert plain["delivery"] is None
    assert report["score"] == plain["score"]  # Delivery never changes the score.


def test_media_in_an_answer_is_refused(client):
    sid, question = started(client)

    response = client.post(f"/api/v1/sessions/{sid}/answers", json={
        "question_id": question["id"], "text": ANSWER,
        "delivery": {"answer_seconds": 30, "spoken": True, "video": "data:video/webm;base64,AAAA"}})

    assert response.status_code == 422
