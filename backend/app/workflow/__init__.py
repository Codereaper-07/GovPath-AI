"""DETERMINISTIC WORKFLOW LAYER.

Builds dependency graphs from verified knowledge and orders steps with stdlib graphlib.
Pure, testable logic. Must never import from app.rag, app.llm or google.genai
(enforced by tests/test_layer_boundaries.py).
"""
