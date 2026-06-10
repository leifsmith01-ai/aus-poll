"""
Tests for the unified per-state schema template
(state_schema_template.sql rendered via pipeline.database.build_state_schema_sql).

The seven non-VIC state/territory schemas were unified into a single
parameterised template. Before the per-state .sql files were deleted, the
rendered DDL was verified to produce a byte-identical sqlite_master
(name + sql) for every state, except for the intentionally-new Legislative
Council (`lc`) tables added for the bicameral states (NSW, WA, SA).
These tests render and initialise all seven states and assert the expected
table inventory and state-specific schema variations.
"""

import sqlite3

import pytest

from pipeline.database import (
    _STATE_SCHEMA_PARAMS,
    build_state_schema_sql,
    init_state_schema,
)

ALL_STATES = sorted(_STATE_SCHEMA_PARAMS)  # act, nsw, nt, qld, sa, tas, wa

PREFERENTIAL_STATES = {"nsw", "qld", "wa", "sa", "nt"}
HARE_CLARK_STATES   = {"tas", "act"}
LC_STATES           = {"nsw", "wa", "sa"}
BOOTH_STATES        = {"nsw", "qld", "wa", "sa", "nt"}


def _master(sql_text: str) -> dict[str, str]:
    """Initialise an in-memory DB and return {object_name: ddl}."""
    conn = sqlite3.connect(":memory:")
    try:
        conn.executescript(sql_text)
        rows = conn.execute(
            "SELECT name, COALESCE(sql, '') FROM sqlite_master "
            "WHERE name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
    finally:
        conn.close()
    return dict(rows)


@pytest.mark.parametrize("state", ALL_STATES)
def test_schema_renders_and_initialises(state):
    """Every state's rendered DDL must execute cleanly against sqlite."""
    sql = build_state_schema_sql(state)
    master = _master(sql)
    assert master, f"{state}: no objects created"
    # No placeholders may survive rendering.
    assert "{p}" not in sql and "{P}" not in sql and "{jurisdiction}" not in sql
    assert "-- @if" not in sql and "-- @endif" not in sql


@pytest.mark.parametrize("state", ALL_STATES)
def test_core_tables_present(state):
    master = _master(build_state_schema_sql(state))
    for table in ("elections", "districts", "candidates", "district_fp"):
        assert f"{state}_{table}" in master, f"{state}_{table} missing"


@pytest.mark.parametrize("state", sorted(PREFERENTIAL_STATES))
def test_preferential_states_have_2cp(state):
    master = _master(build_state_schema_sql(state))
    assert f"{state}_district_2cp" in master
    assert f"{state}_district_party_seats" not in master


@pytest.mark.parametrize("state", sorted(HARE_CLARK_STATES))
def test_hare_clark_states(state):
    master = _master(build_state_schema_sql(state))
    assert f"{state}_district_party_seats" in master
    assert f"{state}_district_2cp" not in master
    # Hare-Clark electorates record the number of seats to fill.
    assert "seats_in_district" in master[f"{state}_districts"]
    # elected column carries the election-order comment.
    assert "election order" in master[f"{state}_candidates"]


@pytest.mark.parametrize("state", sorted(BOOTH_STATES))
def test_booth_tables(state):
    master = _master(build_state_schema_sql(state))
    for table in ("polling_places", "booth_fp", "booth_2cp"):
        assert f"{state}_{table}" in master


@pytest.mark.parametrize("state", sorted(HARE_CLARK_STATES))
def test_hare_clark_states_have_no_booth_tables(state):
    master = _master(build_state_schema_sql(state))
    assert f"{state}_polling_places" not in master
    assert f"{state}_booth_fp" not in master


def test_nt_optional_preferential_exhausted_votes():
    master = _master(build_state_schema_sql("nt"))
    assert "exhausted_votes" in master["nt_district_2cp"]
    assert "exhausted_votes" in master["nt_booth_2cp"]
    # Standard states must NOT have the exhausted column.
    for st in ("nsw", "qld", "wa", "sa"):
        m = _master(build_state_schema_sql(st))
        assert "exhausted_votes" not in m[f"{st}_district_2cp"]


@pytest.mark.parametrize("state", ALL_STATES)
def test_lc_tables_only_in_bicameral_states(state):
    """LC tables are the intentional addition over the old per-state files."""
    master = _master(build_state_schema_sql(state))
    lc_tables = {
        f"{state}_lc_elections",
        f"{state}_lc_groups",
        f"{state}_lc_group_votes",
        f"{state}_lc_members_elected",
    }
    if state in LC_STATES:
        assert lc_tables <= set(master), f"{state}: LC tables missing"
    else:
        assert not (lc_tables & set(master)), f"{state}: unexpected LC tables"


def test_jurisdiction_defaults():
    nsw = _master(build_state_schema_sql("nsw"))
    assert "'nsw_state'" in nsw["nsw_elections"]
    nt = _master(build_state_schema_sql("nt"))
    assert "'nt_territory'" in nt["nt_elections"]
    act = _master(build_state_schema_sql("act"))
    assert "'act_territory'" in act["act_elections"]


def test_vic_rejected():
    with pytest.raises(ValueError):
        build_state_schema_sql("vic")


def test_init_state_schema_uses_template(tmp_path):
    """init_state_schema must apply the rendered template DDL."""
    db = tmp_path / "test.db"
    init_state_schema("sa", db_path=str(db))
    conn = sqlite3.connect(db)
    try:
        names = {
            r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
    finally:
        conn.close()
    assert "sa_districts" in names
    assert "sa_lc_group_votes" in names  # LC tables prove the template path
