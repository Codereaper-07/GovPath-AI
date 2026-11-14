"""AI / RAG LAYER.

Ingestion, chunking, embeddings, retrieval and grounded generation. Output from this
layer is always labelled AI-generated and returned separately from verified facts and
deterministic plans. It may read from app.knowledge / app.workflow, never the reverse.
"""
