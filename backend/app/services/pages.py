"""Placing text on its page inside a chunk that spans several pages."""


def page_segments(text: str, page_starts: list | tuple | None) -> list[tuple[int | None, str]]:
    """A chunk's text split at its page breaks, as (page, text) pairs; one unnumbered segment without them."""
    if not page_starts:
        return [(None, text)]
    bounds = [(int(offset), int(page)) for offset, page in page_starts]
    return [
        (page, text[offset : bounds[i + 1][0] if i + 1 < len(bounds) else len(text)])
        for i, (offset, page) in enumerate(bounds)
    ]

