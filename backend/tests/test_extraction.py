"""M9: text from PDFs (page by page, with PyMuPDF) and TXT files; scanned PDFs are refused."""

import pymupdf
import pytest

from app.services import extraction
from app.services.extraction import ExtractionError, Page, ScannedDocument, extract, tidy

LINE = "Overfitting happens when a model learns the noise in its training data instead of the signal."


def make_pdf(path, pages):
    document = pymupdf.open()
    for text in pages:
        page = document.new_page()
        if text:
            page.insert_textbox(pymupdf.Rect(50, 50, 550, 800), text, fontsize=11)
    document.save(path)
    return path


def make_scanned_pdf(path, pages=2):
    picture = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 200), False)
    picture.clear_with(200)
    document = pymupdf.open()
    for _ in range(pages):
        document.new_page().insert_image(pymupdf.Rect(50, 50, 550, 750), pixmap=picture)
    document.save(path)
    return path


def test_a_pdf_is_read_page_by_page_with_page_numbers(tmp_path):
    path = make_pdf(tmp_path / "notes.pdf", [f"Page one. {LINE}", f"Page two. {LINE}", f"Page three. {LINE}"])

    pages = extract(path)

    assert [page.number for page in pages] == [1, 2, 3]
    assert pages[1].text.startswith("Page two. Overfitting happens")


def test_blank_pages_are_skipped_but_numbering_is_kept(tmp_path):
    path = make_pdf(tmp_path / "notes.pdf", [f"Intro. {LINE} {LINE}", "", f"Part two. {LINE} {LINE}"])

    assert [page.number for page in extract(path)] == [1, 3]


def test_a_scanned_pdf_is_refused_with_a_clear_message(tmp_path):
    with pytest.raises(ScannedDocument, match="looks scanned.*text-based PDF"):
        extract(make_scanned_pdf(tmp_path / "scan.pdf"))


def test_a_pdf_with_no_text_and_no_images_is_refused(tmp_path):
    with pytest.raises(ExtractionError, match="almost no text"):
        extract(make_pdf(tmp_path / "blank.pdf", ["", ""]))


def test_a_damaged_pdf_is_refused(tmp_path):
    path = tmp_path / "broken.pdf"
    path.write_bytes(b"%PDF-1.7\nthis is not really a pdf")
    with pytest.raises(ExtractionError, match="could not be read|no pages"):
        extract(path)


def test_a_password_protected_pdf_is_refused(tmp_path):
    document = pymupdf.open()
    document.new_page().insert_text((50, 72), LINE)
    path = tmp_path / "locked.pdf"
    document.save(path, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="secret", owner_pw="owner")
    with pytest.raises(ExtractionError, match="password-protected"):
        extract(path)


def test_too_many_pages_are_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(extraction, "MAX_PAGES", 2)
    with pytest.raises(ExtractionError, match="more than 2 pages"):
        extract(make_pdf(tmp_path / "long.pdf", [LINE, LINE, LINE]))


def test_too_much_text_is_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(extraction, "MAX_CHARS", 100)
    with pytest.raises(ExtractionError, match="too much text"):
        extract(make_pdf(tmp_path / "dense.pdf", [LINE * 3]))


def test_a_txt_file_is_one_page_without_a_number(tmp_path):
    path = tmp_path / "notes.txt"
    path.write_text(f"﻿{LINE}\n\n\n\nSecond   paragraph.", encoding="utf-8")

    assert extract(path) == [Page(None, f"{LINE}\n\nSecond paragraph.")]


def test_form_feeds_in_a_txt_file_are_page_breaks(tmp_path):
    path = tmp_path / "notes.txt"
    path.write_text(f"{LINE}\f{LINE}", encoding="utf-8")

    assert [page.number for page in extract(path)] == [1, 2]


def test_a_nearly_empty_txt_file_is_refused(tmp_path):
    path = tmp_path / "notes.txt"
    path.write_text("Hi.", encoding="utf-8")
    with pytest.raises(ExtractionError, match="almost no text"):
        extract(path)


def test_tidy_joins_hyphenated_words_and_normalises_spacing():
    assert tidy("regulari-\nsation  works\r\n\n\n\nwell\t here") == "regularisation works\n\nwell here"
