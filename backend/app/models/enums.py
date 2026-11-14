from enum import StrEnum


class AuthProvider(StrEnum):
    GOOGLE = "google"
    GITHUB = "github"
    DEV = "dev"  # The local test user of the development-only sign-in.


class InputModel(StrEnum):
    TOPIC = "TOPIC"
    DOCUMENT = "DOCUMENT"


class SessionState(StrEnum):
    PREPARING = "PREPARING"
    CONFIGURING = "CONFIGURING"
    READY = "READY"
    IN_PROGRESS = "IN_PROGRESS"
    EVALUATING = "EVALUATING"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"


class QuestionType(StrEnum):
    DIRECT = "DIRECT"
    CONCEPTUAL = "CONCEPTUAL"
    CASE_BASED = "CASE_BASED"
    SCENARIO_BASED = "SCENARIO_BASED"
    APPLICATION = "APPLICATION"
    MIXED = "MIXED"  # Config only; a generated question always has a concrete type.


class Difficulty(StrEnum):
    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"


class GroundingStatus(StrEnum):
    VERIFIED = "VERIFIED"
    FLAGGED = "FLAGGED"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class StyleStatus(StrEnum):
    PASSED = "PASSED"
    FLAGGED = "FLAGGED"  # Still off-style after regenerating; kept and reported.
    UNCHECKED = "UNCHECKED"


class DocumentStatus(StrEnum):
    UPLOADED = "UPLOADED"
    PROCESSING = "PROCESSING"
    READY = "READY"
    FAILED = "FAILED"


class MessageRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"


class JobStatus(StrEnum):
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ValidationStatus(StrEnum):
    VALID = "VALID"
    INVALID = "INVALID"
