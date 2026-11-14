"""Indian states and union territories (reference list for jurisdiction matching)."""

STATES_AND_UTS: tuple[str, ...] = (
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat",
    "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
    "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan",
    "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
    "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu",
    "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
)  # fmt: skip


def normalise_state(value: str | None) -> str | None:
    """Return the canonical name for a state/UT (case-insensitive), or None if unknown."""
    if not value:
        return None
    v = value.strip().casefold()
    aliases = {"nct of delhi": "delhi", "new delhi": "delhi", "orissa": "odisha"}
    v = aliases.get(v, v)
    return next((s for s in STATES_AND_UTS if s.casefold() == v), None)
