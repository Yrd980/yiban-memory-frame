from __future__ import annotations

from collections.abc import Generator

from psycopg import Connection

from .db import connection


def db_conn() -> Generator[Connection, None, None]:
    with connection() as conn:
        yield conn
