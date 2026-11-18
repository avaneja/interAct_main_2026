"""A token estimate for sizing text: about four tokens for every three words.

Close enough for chunk sizes and prompt budgets; no tokenizer is needed.
"""

import math


def estimate_tokens(text: str) -> int:
    return math.ceil(len(text.split()) * 4 / 3)
