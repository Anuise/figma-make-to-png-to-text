import os

from google.antigravity import Agent, LocalAgentConfig, types

from .schema import WorkflowDraftBatch

# ADR-0007's model preference order, used only when the SDK's model
# selection is honored -- "Agent mode" abstracts the harness/loop, not the
# model choice, and LocalAgentConfig.model does let us pin it explicitly.
PREFERRED_MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash"]


class AntigravityCallError(RuntimeError):
    """Raised for any Antigravity SDK failure or empty structured output."""


async def generate_workflow_draft_batch(
    prompt: types.Content, model: str = PREFERRED_MODELS[0]
) -> dict:
    """Runs exactly one Agent session for one batch and returns the raw
    structured_output() payload (not yet locally schema-validated -- see
    schema.py's validate_workflow_draft_batch).

    No retry/backoff here: quota-aware retry policy is issue #8's scope,
    not this one. A failure here should be surfaced to the caller so the
    job can be marked failed with a clear reason.
    """
    config = LocalAgentConfig(
        response_schema=WorkflowDraftBatch,
        model=model,
        api_key=os.environ.get("GOOGLE_API_KEY"),
    )
    try:
        async with Agent(config) as agent:
            response = await agent.chat(prompt)
            data = await response.structured_output()
    except (
        types.AntigravityConnectionError,
        types.AntigravityExecutionError,
        types.AntigravityValidationError,
        types.AntigravityCancelledError,
    ) as error:
        raise AntigravityCallError(str(error)) from error

    if data is None:
        raise AntigravityCallError("Antigravity SDK returned no structured output")
    return data
