"""M9: page-aware chunks of 400 to 800 tokens with overlap."""

from sqlalchemy import select

from app.models import Base, Document, DocumentChunk, User
from app.models.enums import AuthProvider
from app.services import documents
from app.services.chunking import MAX_TOKENS, MIN_TOKENS, OVERLAP_TOKENS, chunk_pages, estimate_tokens
from app.services.extraction import Page


def sentences(page, count, start=0):
    return " ".join(f"Sentence {n} on page {page} explains one more idea about overfitting in models." for n in
                    range(start, start + count))


def test_tokens_are_estimated_from_words():
    assert estimate_tokens("one two three") == 4
    assert estimate_tokens("") == 0


def test_a_long_document_is_cut_into_chunks_of_the_right_size():
    pages = [Page(number, sentences(number, 40)) for number in range(1, 11)]

    chunks = chunk_pages(pages)

    assert len(chunks) > 5
    assert [chunk.index for chunk in chunks] == list(range(len(chunks)))
    for chunk in chunks:
        assert MIN_TOKENS <= chunk.tokens <= MAX_TOKENS, chunk.tokens


def test_chunks_end_at_sentence_boundaries_and_overlap():
    chunks = chunk_pages([Page(number, sentences(number, 40)) for number in range(1, 6)])

    for before, after in zip(chunks, chunks[1:]):
        assert before.text.endswith("models.")
        last_sentence = before.text.rsplit("Sentence ", 1)[1]
        assert f"Sentence {last_sentence}" in after.text
        shared = " ".join(set(before.text.split(". ")) & set(after.text.split(". ")))
        assert estimate_tokens(shared) >= OVERLAP_TOKENS * 0.6


def test_every_sentence_is_in_some_chunk():
    pages = [Page(number, sentences(number, 30)) for number in range(1, 5)]
    text = " ".join(chunk.text for chunk in chunk_pages(pages))
    for number in range(1, 5):
        for n in range(30):
            assert f"Sentence {n} on page {number} " in text


def test_chunks_keep_the_pages_they_cover():
    pages = [Page(number, sentences(number, 25)) for number in range(1, 7)]

    chunks = chunk_pages(pages)

    for chunk in chunks:
        assert f"on page {chunk.page} " in chunk.text
        assert f"on page {chunk.page_end} " in chunk.text
        assert chunk.page <= chunk.page_end
    assert any(chunk.page != chunk.page_end for chunk in chunks)
    assert chunks[0].page == 1 and chunks[-1].page_end == 6


def test_a_short_document_is_one_chunk():
    chunks = chunk_pages([Page(None, "A short note about bias and variance. It has two sentences.")])

    assert len(chunks) == 1
    assert (chunks[0].page, chunks[0].page_end) == (None, None)


def test_a_short_tail_joins_the_chunk_before_it_or_shares_its_text():
    for count in range(30, 120, 7):
        chunks = chunk_pages([Page(1, sentences(1, count))])
        if len(chunks) > 1:
            assert all(MIN_TOKENS <= chunk.tokens <= MAX_TOKENS for chunk in chunks), (count, [c.tokens for c in chunks])


def test_a_very_long_sentence_is_cut_by_words():
    giant = " ".join(["word"] * 2000)

    chunks = chunk_pages([Page(1, giant)])

    assert all(chunk.tokens <= MAX_TOKENS for chunk in chunks)
    assert sum(len(chunk.text.split()) for chunk in chunks) >= 2000


def test_repeated_sentences_are_kept():
    same = "The same sentence repeats here for emphasis. " * 120
    text = " ".join(chunk.text for chunk in chunk_pages([Page(1, same)]))
    assert text.count("The same sentence repeats") >= 120


def test_chunks_are_saved_in_order_with_their_pages(db_engine, db_session):
    Base.metadata.create_all(db_engine)
    user = User(auth_provider=AuthProvider.GOOGLE, provider_user_id="1", display_name="Ada")
    db_session.add(user)
    db_session.commit()
    document = Document(owner_id=user.id, filename="notes.pdf", storage_key="k.pdf")
    db_session.add(document)
    db_session.commit()
    chunks = chunk_pages([Page(number, sentences(number, 40)) for number in range(1, 4)])

    documents.save_chunks(db_session, document, chunks)
    documents.save_chunks(db_session, document, chunks)  # Saving again replaces, never duplicates.

    rows = db_session.scalars(select(DocumentChunk).order_by(DocumentChunk.chunk_index)).all()
    assert [(row.chunk_index, row.page, row.page_end, row.text) for row in rows] == [
        (chunk.index, chunk.page, chunk.page_end, chunk.text) for chunk in chunks]


def test_each_chunk_knows_where_its_pages_start():
    from app.services.pages import page_segments

    pages = [Page(number, sentences(number, 12)) for number in range(1, 7)]

    chunks = chunk_pages(pages)

    for chunk in chunks:
        segments = page_segments(chunk.text, chunk.page_starts)
        assert [page for page, _ in segments] == list(range(chunk.page, chunk.page_end + 1))
        for page, text in segments:
            assert f"on page {page} " in text
            assert not any(f"on page {other} " in text for other in range(1, 7) if other != page)


def test_text_without_page_numbers_is_one_segment():
    from app.services.pages import page_segments

    chunk = chunk_pages([Page(None, "Bias and variance. " * 30)])[0]
    assert chunk.page_starts == ()
    assert page_segments(chunk.text, chunk.page_starts) == [(None, chunk.text)]
