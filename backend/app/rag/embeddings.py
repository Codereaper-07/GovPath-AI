"""Input formatting for gemini-embedding-2.

The model takes no task_type; the task is written as a text prefix (per the Gemini embeddings
docs). Truncated outputs such as 768 dims are normalised by the API.
"""


def format_query(query: str) -> str:
    return f"task: question answering | query: {query}"


def format_document(text: str, title: str | None = None) -> str:
    return f"title: {title or 'none'} | text: {text}"
