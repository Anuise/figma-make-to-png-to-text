import os

import pytest

from ai_worker.antigravity_client import PREFERRED_MODELS, generate_workflow_draft_batch


@pytest.mark.asyncio
async def test_smoke_generates_a_minimal_workflow_draft_batch():
    """AC1: a minimal smoke test proving the Antigravity SDK integration
    actually works end-to-end. Skipped (not failed) without a real
    GOOGLE_API_KEY -- this is the only test in the suite allowed to touch
    the real network."""
    if not os.environ.get("GOOGLE_API_KEY"):
        pytest.skip("GOOGLE_API_KEY not set; skipping live Antigravity SDK smoke test")

    prompt = (
        "Given a single confirmed screen at route '/checkout' with the user "
        "goal 'Complete checkout', produce exactly one workflow draft in the "
        "requested structured format. Set related_screen_ids to "
        "['smoke-test-screen']."
    )
    data = await generate_workflow_draft_batch(prompt, model=PREFERRED_MODELS[0])
    assert isinstance(data, dict)
    assert len(data.get("drafts", [])) >= 1
