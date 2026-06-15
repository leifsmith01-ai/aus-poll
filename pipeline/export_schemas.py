"""
Lightweight, dependency-free shape validation for the JSON files written by
``export.py``.

The frontend (``webapp/src/App.jsx``) embeds hardcoded constants
(``SEAT_FP_2025``, ``SEAT_PREF_FLOWS_2025``, ``SEAT_CALIB_2025`` …) that are
derived from these exports by ``scripts/update_s25_from_exports.py`` /
``scripts/inject_model_constants.py``. Nothing previously checked that the
exported JSON kept the shape those scripts (and the dashboard) expect, so a
field rename or a dropped key would only surface as a silent data drop in the
browser. ``_write_json`` now runs these schemas before writing, so the export
fails loudly instead.

Schemas are keyed by file *basename*. Only the federal-unique exports are
registered (``divisions.json`` / ``national_summary.json`` /
``preference_flows.json``). State and VIC exports use different basenames
(``districts.json`` / ``summary.json`` / ``state_summary.json``), so there is
no collision; files without a registered schema are written unchecked.
"""

from __future__ import annotations

NUMBER = (int, float)


class ExportSchemaError(ValueError):
    """Raised when an export payload does not match its declared schema."""


def _check_type(label: str, value, expected) -> None:
    """``expected`` may be a type, a tuple of types, or include ``type(None)``
    for nullable fields."""
    if not isinstance(value, expected):
        names = (
            expected.__name__
            if isinstance(expected, type)
            else "/".join(t.__name__ for t in expected)
        )
        raise ExportSchemaError(
            f"{label}: expected {names}, got {type(value).__name__}"
        )


def _check_record(label: str, record, fields: dict) -> None:
    if not isinstance(record, dict):
        raise ExportSchemaError(f"{label}: expected object, got {type(record).__name__}")
    for key, expected in fields.items():
        if key not in record:
            raise ExportSchemaError(f"{label}: missing required key '{key}'")
        _check_type(f"{label}.{key}", record[key], expected)


def _validate_divisions(data) -> None:
    if not isinstance(data, list):
        raise ExportSchemaError(f"divisions.json: expected list, got {type(data).__name__}")
    if not data:
        raise ExportSchemaError("divisions.json: expected at least one division")
    fields = {
        "division_id": int,
        "division_name": str,
        "state_ab": str,
        "winner": (dict, type(None)),
        "tcp": list,
        "margin_votes": (int, type(None)),
        "margin_pct": (float, int, type(None)),
        "first_prefs": list,
    }
    for i, record in enumerate(data):
        _check_record(f"divisions.json[{i}]", record, fields)


def _validate_national_summary(data) -> None:
    _check_record(
        "national_summary.json",
        data,
        {
            "parties": list,
            "seats_won": list,
            "total_votes": NUMBER,
            "coalition_combined": dict,
        },
    )


def _validate_preference_flows(data) -> None:
    _check_record(
        "preference_flows.json",
        data,
        {"election_id": int, "by_division": dict},
    )
    for div_id, flows in data["by_division"].items():
        if not isinstance(flows, dict):
            raise ExportSchemaError(
                f"preference_flows.json.by_division['{div_id}']: expected object, "
                f"got {type(flows).__name__}"
            )


# Keyed by file basename. Federal-unique names only — see module docstring.
SCHEMAS = {
    "divisions.json": _validate_divisions,
    "national_summary.json": _validate_national_summary,
    "preference_flows.json": _validate_preference_flows,
}


def validate_export(filename: str, data) -> None:
    """Validate ``data`` against the schema registered for ``filename``.

    No-op when the basename has no registered schema. Raises
    :class:`ExportSchemaError` on mismatch.
    """
    validator = SCHEMAS.get(filename)
    if validator is not None:
        validator(data)
