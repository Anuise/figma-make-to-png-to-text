import pytest

from ai_worker.schema import SchemaValidationError, validate_workflow_draft_batch


def _valid_payload(screen_id: str) -> dict:
    return {
        "drafts": [
            {
                "user_goal": "Complete checkout",
                "preconditions": ["Cart has at least one item"],
                "steps": ["Open checkout", "Submit payment"],
                "expected_result": "Order confirmation shown",
                "exceptions": ["Payment declined"],
                "related_screen_ids": [screen_id],
            }
        ]
    }


def test_accepts_a_valid_batch():
    screen_id = "11111111-1111-1111-1111-111111111111"
    batch = validate_workflow_draft_batch(_valid_payload(screen_id), {screen_id})
    assert len(batch.drafts) == 1
    assert batch.drafts[0].related_screen_ids == [screen_id]


def test_rejects_a_batch_missing_required_fields():
    payload = {"drafts": [{"user_goal": "Complete checkout"}]}
    with pytest.raises(SchemaValidationError):
        validate_workflow_draft_batch(payload, set())


def test_drops_related_screen_ids_outside_the_frozen_batch_without_failing():
    screen_id = "11111111-1111-1111-1111-111111111111"
    hallucinated_id = "22222222-2222-2222-2222-222222222222"
    payload = _valid_payload(screen_id)
    payload["drafts"][0]["related_screen_ids"].append(hallucinated_id)

    batch = validate_workflow_draft_batch(payload, {screen_id})
    assert batch.drafts[0].related_screen_ids == [screen_id]


def test_rejects_a_batch_with_an_empty_steps_list():
    screen_id = "11111111-1111-1111-1111-111111111111"
    payload = _valid_payload(screen_id)
    payload["drafts"][0]["steps"] = []
    with pytest.raises(SchemaValidationError):
        validate_workflow_draft_batch(payload, {screen_id})
