class PlanningError(Exception):
    """Base class for planner input/knowledge errors."""


class UnknownIdsError(PlanningError):
    def __init__(
        self,
        unknown_service_ids: list[str] | tuple[str, ...] = (),
        unknown_document_ids: list[str] | tuple[str, ...] = (),
    ):
        self.unknown_service_ids = sorted(set(unknown_service_ids))
        self.unknown_document_ids = sorted(set(unknown_document_ids))
        parts = []
        if self.unknown_service_ids:
            parts.append(f"unknown service ids: {', '.join(self.unknown_service_ids)}")
        if self.unknown_document_ids:
            parts.append(f"unknown document ids: {', '.join(self.unknown_document_ids)}")
        super().__init__("; ".join(parts))


class EmptySelectionError(PlanningError):
    def __init__(self) -> None:
        super().__init__("at least one target service must be selected")


class DependencyCycleError(PlanningError):
    def __init__(self, cycle: list[str]):
        self.cycle = cycle
        super().__init__(f"dependency cycle detected: {' -> '.join(cycle)}")
