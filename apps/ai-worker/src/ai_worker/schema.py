from typing import Any

import jsonschema
from pydantic import BaseModel, Field


class WorkflowDraftItem(BaseModel):
    user_goal: str = Field(min_length=1)
    preconditions: list[str] = Field(default_factory=list)
    steps: list[str] = Field(min_length=1)
    expected_result: str = Field(min_length=1)
    exceptions: list[str] = Field(default_factory=list)
    related_screen_ids: list[str] = Field(default_factory=list)


class WorkflowDraftBatch(BaseModel):
    drafts: list[WorkflowDraftItem] = Field(default_factory=list)


# Single source of truth for both the SDK's response_schema (Pydantic) and
# the local JSON Schema validation AC4 explicitly requires -- generated from
# the same model so the two can never drift apart.
WORKFLOW_DRAFT_BATCH_JSON_SCHEMA: dict[str, Any] = WorkflowDraftBatch.model_json_schema()


class SchemaValidationError(ValueError):
    """Raised when raw AI output fails local JSON Schema validation (AC4)."""


def validate_workflow_draft_batch(
    data: Any, allowed_screen_ids: set[str]
) -> WorkflowDraftBatch:
    """Validates raw AI output against the local JSON Schema, then parses it
    into typed models.

    A related_screen_id outside the frozen batch is dropped (the rest of
    that draft is kept) rather than failing the whole batch -- a single
    hallucinated reference shouldn't sink an otherwise-good set of drafts.
    """
    try:
        jsonschema.validate(data, WORKFLOW_DRAFT_BATCH_JSON_SCHEMA)
    except jsonschema.ValidationError as error:
        raise SchemaValidationError(str(error)) from error

    batch = WorkflowDraftBatch.model_validate(data)
    for draft in batch.drafts:
        draft.related_screen_ids = [
            screen_id
            for screen_id in draft.related_screen_ids
            if screen_id in allowed_screen_ids
        ]
    return batch
