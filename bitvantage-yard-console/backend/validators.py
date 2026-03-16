import re
from typing import Any, Dict

POSITION_SEGMENT_PATTERN = re.compile(r"^\d{2,3}$")
ALLOWED_CONTAINER_TYPES = {"20ft", "40ft", "45ft"}


def normalize_container_type(container_type: str) -> str:
    normalized = str(container_type).strip().lower()
    if normalized not in ALLOWED_CONTAINER_TYPES:
        allowed = ", ".join(sorted(ALLOWED_CONTAINER_TYPES))
        raise ValueError(f"Unsupported container type. Allowed values: {allowed}.")
    return normalized


def validate_position(container_type: str, block: str, bay: str, row: int, tier: int) -> Dict[str, Any]:
    normalized_type = normalize_container_type(container_type)
    normalized_block = str(block).strip()
    normalized_bay = str(bay).strip()

    if not POSITION_SEGMENT_PATTERN.fullmatch(normalized_block):
        raise ValueError("Block must contain exactly 2 digits, or 3 digits in exceptional cases.")
    if not POSITION_SEGMENT_PATTERN.fullmatch(normalized_bay):
        raise ValueError("Bay must contain exactly 2 digits, or 3 digits in exceptional cases.")
    if row < 1 or row > 99:
        raise ValueError("Row must be a number from 1 to 99.")
    if tier < 1 or tier > 4:
        raise ValueError("Tier must be a number from 1 to 4.")

    bay_num = int(normalized_bay)
    is_even_bay = bay_num % 2 == 0
    if normalized_type == "20ft" and is_even_bay:
        raise ValueError("Rule violation: 20ft containers cannot be placed in even bays.")
    if normalized_type in {"40ft", "45ft"} and not is_even_bay:
        raise ValueError(f"Rule violation: {normalized_type} containers cannot be placed in odd bays.")

    return {
        "container_type": normalized_type,
        "block": normalized_block,
        "bay": normalized_bay,
        "row": row,
        "tier": tier,
        "position_code": f"{normalized_block}-{normalized_bay}-{row}-{tier}",
    }
