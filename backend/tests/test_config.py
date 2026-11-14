import pytest

from app.config import Settings, to_psycopg_url


@pytest.mark.parametrize(
    "raw",
    [
        "postgresql://u:p@host:5432/postgres",
        "postgres://u:p@host:5432/postgres",
        "postgresql+psycopg://u:p@host:5432/postgres",
    ],
)
def test_url_is_rewritten_to_psycopg(raw: str) -> None:
    assert to_psycopg_url(raw) == "postgresql+psycopg://u:p@host:5432/postgres"


def test_unencoded_special_chars_in_password_are_encoded() -> None:
    raw = "postgresql://postgres.ref:p@ss:w/rd@host.example:5432/postgres"
    assert to_psycopg_url(raw) == (
        "postgresql+psycopg://postgres.ref:p%40ss%3Aw%2Frd@host.example:5432/postgres"
    )


def test_already_encoded_password_is_unchanged() -> None:
    raw = "postgresql://postgres.ref:p%40ss@host.example:5432/postgres"
    assert (
        to_psycopg_url(raw) == "postgresql+psycopg://postgres.ref:p%40ss@host.example:5432/postgres"
    )


def test_non_postgres_url_rejected() -> None:
    with pytest.raises(ValueError):
        to_psycopg_url("mysql://u:p@host/db")


def test_empty_values_mean_unconfigured() -> None:
    s = Settings(_env_file=None, database_url="  ", gemini_api_key="")
    assert s.database_configured is False
    assert s.gemini_api_key is None


def test_defaults_match_approved_models() -> None:
    s = Settings(_env_file=None)
    assert s.gemini_model == "gemini-3.6-flash"
    assert s.gemini_embedding_model == "gemini-embedding-2"
    assert s.embedding_dim == 768


def test_cors_origins_parsed_from_csv() -> None:
    s = Settings(_env_file=None, cors_origins="http://a.test, http://b.test")
    assert s.cors_origins == ["http://a.test", "http://b.test"]
