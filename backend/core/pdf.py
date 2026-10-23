"""PDF rendering for invoices, payment receipts and reports (ReportLab).

Public API (all return the PDF as ``bytes``)::

    render_invoice_pdf(doc: dict, fmt: str = 'a4') -> bytes   # fmt: a4 | a5 | thermal80 | thermal58
    render_receipt_pdf(doc: dict, fmt: str = 'a4') -> bytes
    render_report_pdf(report: dict) -> bytes
    rich(text, bold=False) -> str                             # safe Paragraph markup for user text

Gujarati support: all user text goes through :func:`rich`, which escapes XML
and wraps Gujarati runs in the NotoSansGujarati font; paragraphs are shaped
with HarfBuzz (``shaping=1``). ReportLab shapes a whole whitespace-delimited
word with the font of its first run, which garbles or crashes on words such as
``ઘનશ્યામભાઈ,`` or ``પેનલ-90W``; :func:`_install_shaping_patch` makes it shape
each font run separately.

This module does not touch Django settings and can be used from plain scripts.
"""
import re
import threading
from decimal import Decimal
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4, A5, landscape, portrait
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import registerFontFamily, stringWidth
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    BaseDocTemplate, Flowable, Frame, HRFlowable, Image, KeepTogether, PageTemplate,
    Paragraph, Spacer, Table, TableStyle,
)

from .money import D, fmt_money, fmt_qty, q2

try:  # core.dates imports Django/DRF helpers; keep a fallback for bare scripts.
    from .dates import fmt_date
except Exception:  # pragma: no cover
    def fmt_date(d):
        return d.strftime('%d/%m/%Y') if d else ''

__all__ = ['render_invoice_pdf', 'render_receipt_pdf', 'render_report_pdf', 'rich', 'register_fonts', 'format_value']

# --------------------------------------------------------------------------- #
# Fonts
# --------------------------------------------------------------------------- #
FONT_DIR = Path(__file__).resolve().parent.parent / 'assets' / 'fonts'

FONT = 'NotoSans'
FONT_BOLD = 'NotoSans-Bold'
GUJ_FONT = 'NotoSansGujarati'
GUJ_FONT_BOLD = 'NotoSansGujarati-Bold'

_FONT_FILES = (
    (FONT, 'NotoSans-Regular.ttf'),
    (FONT_BOLD, 'NotoSans-Bold.ttf'),
    (GUJ_FONT, 'NotoSansGujarati-Regular.ttf'),
    (GUJ_FONT_BOLD, 'NotoSansGujarati-Bold.ttf'),
)

# Characters drawn with the Gujarati font: Gujarati block, ZWNJ/ZWJ, dandas.
_GUJ_CLASS = '\u0A80-\u0AFF\u200C\u200D\u0964\u0965'
_GUJ_RUN_RE = re.compile(f'[{_GUJ_CLASS}]+(?:[ \u00A0]+[{_GUJ_CLASS}]+)*')
_GUJ_ANY_RE = re.compile('[\u0A80-\u0AFF]')

# Symbols missing from both fonts that have a sensible ASCII fallback.
_REPLACEMENTS = (
    ('\r\n', '\n'), ('\r', '\n'), ('\t', ' '), ('\u00AD', ''),
    ('\u2192', '->'), ('\u2190', '<-'), ('\u2194', '<->'), ('\u21D2', '=>'), ('\u21D0', '<='),
    ('\u27A1', '->'), ('\u2B05', '<-'), ('\u2794', '->'), ('\u279C', '->'),
    ('\u2713', 'v'), ('\u2714', 'v'), ('\u2715', 'x'), ('\u2716', 'x'), ('\u2717', 'x'),
    ('\u2264', '<='), ('\u2265', '>='), ('\u2260', '!='),
)

_font_lock = threading.RLock()
_render_lock = threading.RLock()   # ReportLab keeps mutable per-font shaping state
_fonts_ready = False
_supported_codepoints = frozenset()


def register_fonts():
    """Register the Noto fonts + families once per process (thread safe)."""
    global _fonts_ready, _supported_codepoints
    if _fonts_ready:
        return
    with _font_lock:
        if _fonts_ready:
            return
        for name, filename in _FONT_FILES:
            pdfmetrics.registerFont(TTFont(name, str(FONT_DIR / filename)))
        registerFontFamily(FONT, normal=FONT, bold=FONT_BOLD, italic=FONT, boldItalic=FONT_BOLD)
        registerFontFamily(GUJ_FONT, normal=GUJ_FONT, bold=GUJ_FONT_BOLD,
                           italic=GUJ_FONT, boldItalic=GUJ_FONT_BOLD)

        def cmap(name):
            return set(pdfmetrics.getFont(name).face.charToGlyph)

        latin = cmap(FONT) & cmap(FONT_BOLD)
        guj_class = re.compile(f'[{_GUJ_CLASS}]')
        guj = {c for c in (cmap(GUJ_FONT) & cmap(GUJ_FONT_BOLD)) if guj_class.match(chr(c))}
        _supported_codepoints = frozenset(latin | guj)
        _install_shaping_patch()
        _fonts_ready = True


def _install_shaping_patch():
    """Shape multi-font words one font run at a time (idempotent).

    ``reportlab.pdfbase.ttfonts.shapeFragWord`` shapes all text of a word with
    the first fragment's font and maps glyph ids back to every fragment, so a
    word mixing Gujarati and Latin characters raises ``AttributeError``
    (``hbAddPrivate``) or draws wrong glyphs.
    """
    try:
        from reportlab.pdfbase import ttfonts as rl_ttfonts
        from reportlab.platypus import paragraph as rl_paragraph
    except ImportError:  # pragma: no cover
        return
    original = getattr(rl_paragraph, 'shapeFragWord', None)
    if original is None or getattr(original, '_per_font_run', False):
        return
    make_word = getattr(rl_ttfonts, 'makeShapedFragWord', None)
    shaped_cls = getattr(rl_ttfonts, 'ShapedFragWord', None)
    if make_word is None or shaped_cls is None:  # pragma: no cover - unknown ReportLab layout
        return

    def shape_frag_word(w, *args, **kwargs):
        if isinstance(w, shaped_cls) or len(w) < 3:
            return original(w, *args, **kwargs)
        runs, run_font = [], None
        for item in w[1:]:
            frag = item[0]
            font_name = None if hasattr(frag, 'cbDefn') else getattr(frag, 'fontName', None)
            if not runs or (font_name is not None and run_font is not None and font_name != run_font):
                runs.append([])
            if font_name is not None:
                run_font = font_name
            runs[-1].append(item)
        if len(runs) < 2:
            return original(w, *args, **kwargs)
        merged = make_word(w)([])
        total, changed = 0, False
        for run in runs:
            width = sum(stringWidth(text, frag.fontName, frag.fontSize)
                        for frag, text in run if not hasattr(frag, 'cbDefn'))
            sub = [width] + list(run)
            result = original(sub, *args, **kwargs)
            changed = changed or result is not sub
            total += result[0]
            merged.extend(result[1:])
        if not changed:
            return w
        merged.insert(0, total)
        return merged

    shape_frag_word._per_font_run = True
    rl_paragraph.shapeFragWord = shape_frag_word


# --------------------------------------------------------------------------- #
# Text helpers
# --------------------------------------------------------------------------- #
def _clean(text):
    """Normalise user text: str(), newlines, known symbol fallbacks, drop glyphs no font has."""
    if text is None:
        return ''
    text = str(text)
    if not text:
        return ''
    for old, new in _REPLACEMENTS:
        if old in text:
            text = text.replace(old, new)
    if text.isascii() and text.isprintable():
        return text
    register_fonts()
    supported = _supported_codepoints
    return ''.join(ch for ch in text if ch == '\n' or ord(ch) in supported)


def _escape(text):
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


class Para(Paragraph):
    """Paragraph that re-uses its line breaks when wrapped again at the same width.

    Tables wrap cell paragraphs when sizing rows and again when drawing (and
    after page splits); caching keeps long reports fast.
    """

    def wrap(self, availWidth, availHeight):
        cached = self.__dict__.get('_wrap_cache')
        # Paragraph.split() deletes blPara when it cannot split; re-break the lines then.
        if cached is not None and cached[0] == availWidth and 'blPara' in self.__dict__:
            return cached[1]
        result = Paragraph.wrap(self, availWidth, availHeight)
        self._wrap_cache = (availWidth, result)
        return result


def rich(text, bold=False):
    """Paragraph markup for user text: escaped, newlines -> <br/>, Gujarati runs in the Gujarati font."""
    text = _clean(text)
    if not text:
        return ''
    guj_font = GUJ_FONT_BOLD if bold else GUJ_FONT
    parts, pos = [], 0
    for match in _GUJ_RUN_RE.finditer(text):
        if match.start() > pos:
            parts.append(_escape(text[pos:match.start()]))
        parts.append(f'<font name="{guj_font}">{_escape(match.group())}</font>')
        pos = match.end()
    if pos < len(text):
        parts.append(_escape(text[pos:]))
    return ''.join(parts).replace('\n', '<br/>')


def _s(value):
    """Plain string for a (possibly None) value."""
    return '' if value is None else str(value).strip()


def _keep_together(value, max_len=18):
    """Short values such as phone numbers: non-breaking spaces so they never wrap mid-number."""
    text = _s(value)
    return text.replace(' ', chr(0xA0)) if len(text) <= max_len else text


# --------------------------------------------------------------------------- #
# Colours & styles
# --------------------------------------------------------------------------- #
BRAND = colors.HexColor('#1d4ed8')
BRAND_LIGHT = colors.HexColor('#eff6ff')
SLATE_50 = colors.HexColor('#f8fafc')
BORDER = colors.HexColor('#e2e8f0')
TEXT = colors.HexColor('#0f172a')
MUTED = colors.HexColor('#475569')
FAINT = colors.HexColor('#64748b')
WHITE = colors.white
BLACK = colors.black
GREEN = colors.HexColor('#15803d')
AMBER = colors.HexColor('#b45309')
RED = colors.HexColor('#b91c1c')

STATUS_COLORS = {
    'paid': (GREEN, colors.HexColor('#f0fdf4')),
    'partial': (AMBER, colors.HexColor('#fffbeb')),
    'unpaid': (RED, colors.HexColor('#fef2f2')),
}

_style_cache = {}


def _ps(size, bold=False, color=TEXT, align=TA_LEFT, leading=None, space_after=0, space_before=0,
        keep_with_next=False, shaping=True):
    """Cached ParagraphStyle; HarfBuzz shaping is on unless explicitly disabled for Latin-only text."""
    leading = round(leading if leading is not None else size * 1.32, 2)
    key = (size, bold, color.hexval(), align, leading, space_after, space_before, keep_with_next, shaping)
    style = _style_cache.get(key)
    if style is None:
        with _font_lock:
            style = ParagraphStyle(
                name=f'tallin-{len(_style_cache)}', fontName=FONT_BOLD if bold else FONT,
                fontSize=size, leading=leading, textColor=color, alignment=align,
                spaceAfter=space_after, spaceBefore=space_before, keepWithNext=int(keep_with_next),
                shaping=int(bool(shaping)), splitLongWords=1, allowWidows=1, allowOrphans=1,
            )
            _style_cache[key] = style
    return style


def _p(text, style):
    """Shaped paragraph from user text (escaped via rich; Gujarati weight follows the style)."""
    return Para(rich(text, bold=style.fontName == FONT_BOLD), style)


def _text_width(text, size, bold=False):
    """Approximate width of Latin text (used only for column sizing)."""
    return stringWidth(_clean(text), FONT_BOLD if bold else FONT, size)


# --------------------------------------------------------------------------- #
# Canvas / document plumbing
# --------------------------------------------------------------------------- #
def _numbered_canvas(footer=None, stats=None):
    """Canvas class that defers page decoration until the page count is known."""

    class NumberedCanvas(Canvas):
        def __init__(self, *args, **kwargs):
            Canvas.__init__(self, *args, **kwargs)
            self._saved_pages = []

        def showPage(self):
            self._saved_pages.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._saved_pages)
            if stats is not None:
                stats['pages'] = total
            for number, state in enumerate(self._saved_pages, 1):
                self.__dict__.update(state)
                if footer is not None:
                    footer(self, number, total)
                Canvas.showPage(self)
            Canvas.save(self)

    return NumberedCanvas


def _build(story, pagesize, margins, footer=None, info=None, stats=None):
    left, right, top, bottom = margins
    buf = BytesIO()
    info = info or {}
    doc = BaseDocTemplate(
        buf, pagesize=pagesize, leftMargin=left, rightMargin=right, topMargin=top, bottomMargin=bottom,
        title=_clean(info.get('title')), author=_clean(info.get('author')),
        subject=_clean(info.get('subject')), creator='Gemini',
    )
    frame = Frame(left, bottom, pagesize[0] - left - right, pagesize[1] - top - bottom, id='body',
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id='page', frames=[frame])])
    doc.build(story, canvasmaker=_numbered_canvas(footer, stats))
    return buf.getvalue()


def _flowable_height(flowable, width):
    _, height = flowable.wrap(width, 10 ** 7)
    return height + flowable.getSpaceBefore() + flowable.getSpaceAfter()


def _build_fitted(make_story, page_width, margin, info=None):
    """Single page whose height fits the content exactly (thermal rolls)."""
    avail = page_width - 2 * margin
    height = sum(_flowable_height(f, avail) for f in make_story()) + 2 * margin + 4
    for _ in range(6):
        stats = {}
        pdf = _build(make_story(), (page_width, height), (margin, margin, margin, margin),
                     info=info, stats=stats)
        if stats.get('pages', 1) <= 1:
            return pdf
        height *= 1.2
    return pdf


def _page_footer(size, margin_x, margin_bottom, title_markup=None, last_page_note=None):
    """Footer callback: 'Page X of Y' centred, or title left + page number right with a rule.
    `last_page_note` (e.g. "Thank you for your business!") is centred above it on the last page."""
    title_style = _ps(size, color=FAINT, leading=size * 1.2)
    note_style = _ps(size * 1.12, color=MUTED, align=TA_CENTER, leading=size * 1.4)

    def draw(canv, number, total):
        width = canv._pagesize[0]
        y = margin_bottom * 0.42
        text = f'Page {number} of {total}'
        if last_page_note and number == total:
            note = Para(rich(last_page_note), note_style)
            _, height = note.wrap(width - 2 * margin_x, size * 3)
            note.drawOn(canv, margin_x, y + size * 1.6)
        canv.saveState()
        canv.setFont(FONT, size)
        canv.setFillColor(FAINT)
        if title_markup:
            canv.setStrokeColor(BORDER)
            canv.setLineWidth(0.6)
            canv.line(margin_x, y + size * 1.45, width - margin_x, y + size * 1.45)
            canv.drawRightString(width - margin_x, y, text)
            avail = width - 2 * margin_x - stringWidth(text, FONT, size) - 16
            para = Para(title_markup, title_style)
            _, height = para.wrap(avail, size * 3)
            para.drawOn(canv, margin_x, y - height + size * 1.2)
        else:
            canv.drawCentredString(width / 2.0, y, text)
        canv.restoreState()

    return draw


# --------------------------------------------------------------------------- #
# Small flowables
# --------------------------------------------------------------------------- #
def _logo(path, max_w, max_h, align='LEFT'):
    """Logo image flowable scaled to fit (max_w, max_h); None when missing/unreadable."""
    if not path:
        return None
    try:
        from PIL import Image as PILImage, ImageOps
        source = Path(str(path))
        if not source.is_file():
            return None
        with PILImage.open(source) as im:
            im.load()
            im = ImageOps.exif_transpose(im)
            has_alpha = im.mode in ('RGBA', 'LA', 'PA') or (im.mode == 'P' and 'transparency' in im.info)
            im = im.convert('RGBA' if has_alpha else 'RGB')
            px_w, px_h = im.size
            if px_w < 1 or px_h < 1:
                return None
            scale = min(max_w / px_w, max_h / px_h)
            draw_w, draw_h = px_w * scale, px_h * scale
            limit = 4 * max(draw_w, draw_h)  # ~288 dpi is plenty for print
            if max(px_w, px_h) > limit:
                factor = limit / max(px_w, px_h)
                im = im.resize((max(1, round(px_w * factor)), max(1, round(px_h * factor))),
                               PILImage.LANCZOS)
            buf = BytesIO()
            im.save(buf, 'PNG', optimize=True)
        buf.seek(0)
        return Image(buf, width=draw_w, height=draw_h, hAlign=align)
    except Exception:
        return None


class Pill(Flowable):
    """Rounded status badge; text is laid out with a shaped Paragraph."""

    def __init__(self, text, color, fill, size, align='RIGHT'):
        super().__init__()
        self.hAlign = align
        self.color, self.fill, self.size = color, fill, size
        self.pad_x, self.pad_y = size * 0.9, size * 0.38
        self.para = Para(rich(text, bold=True), _ps(size, bold=True, color=color, leading=size * 1.25))

    def wrap(self, avail_w, avail_h):
        inner = max(avail_w - 2 * self.pad_x, 10)
        self.para.wrap(inner, avail_h)
        widths = self.para.getActualLineWidths0() or [0]
        text_w = min(max(widths) + 1, inner)
        _, text_h = self.para.wrap(text_w, avail_h)
        self.text_w, self.text_h = text_w, text_h
        self.width = text_w + 2 * self.pad_x
        self.height = text_h + 2 * self.pad_y
        return self.width, self.height

    def draw(self):
        canv = self.canv
        canv.saveState()
        canv.setFillColor(self.fill)
        canv.setStrokeColor(self.color)
        canv.setLineWidth(0.8)
        canv.roundRect(0, 0, self.width, self.height, min(self.height / 2.0, 6), stroke=1, fill=1)
        canv.restoreState()
        self.para.drawOn(canv, self.pad_x, self.pad_y - self.size * 0.06)


class DataTable(Table):
    """Table for long data; NOSPLIT bookkeeping only covers the NOSPLIT cells.

    ReportLab's ``_calcNoSplitRanges`` creates an entry for every cell each time
    a table is re-laid out after a page split (O(pages x cells)); only entries
    of cells inside NOSPLIT ranges are ever read (``_getRowImpossible``).
    """

    def _calcNoSplitRanges(self):
        self._nosplitRanges = ranges = {}
        self._colNoSplitCells = col_cells = []
        self._rowNoSplitCells = row_cells = []
        for _cmd, (x0, y0), (x1, y1) in self._nosplitCmds:
            if x0 < 0:
                x0 += self._ncols
            if x1 < 0:
                x1 += self._ncols
            if y0 < 0:
                y0 += self._nrows
            if y1 < 0:
                y1 += self._nrows
            x0, x1 = min(x0, x1), max(x0, x1)
            y0, y1 = min(y0, y1), max(y0, y1)
            if x0 == x1 and y0 == y1:
                continue
            cells = [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]
            if x0 != x1:
                col_cells.extend(cells)
            if y0 != y1:
                row_cells.extend(cells)
            for xy in cells:
                ranges[xy] = None
            ranges[x0, y0] = (x0, y0, x1, y1)


def _rule(color=BORDER, thickness=0.8, before=0, after=0, dash=None):
    return HRFlowable(width='100%', thickness=thickness, color=color, spaceBefore=before,
                      spaceAfter=after, dash=dash, lineCap='butt')


def _plain_table(rows, col_widths, commands=(), **kwargs):
    base = [
        ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]
    kwargs.setdefault('hAlign', 'LEFT')
    table = Table(rows, colWidths=col_widths, **kwargs)
    table.setStyle(TableStyle(base + list(commands)))
    return table


# --------------------------------------------------------------------------- #
# Shared blocks for full-page (A4 / A5) documents
# --------------------------------------------------------------------------- #
FULL_PAGE_FORMATS = ('a4', 'a5')
THERMAL_WIDTHS = {'thermal80': 80 * mm, 'thermal58': 58 * mm}


def _normalise_fmt(fmt):
    fmt = _s(fmt).lower().replace('-', '').replace('_', '').replace(' ', '')
    if fmt in ('thermal', 'thermal80mm', '80mm', '80'):
        return 'thermal80'
    if fmt in ('thermal58mm', '58mm', '58'):
        return 'thermal58'
    return fmt if fmt in FULL_PAGE_FORMATS or fmt in THERMAL_WIDTHS else 'a4'


class _Layout:
    """Metrics for full-page documents; A5 is the A4 design scaled down."""

    def __init__(self, fmt):
        if fmt == 'a5':
            self.pagesize, self.scale = A5, 0.8
            self.mx, self.mt, self.mb = 9 * mm, 8 * mm, 12 * mm
        else:
            self.pagesize, self.scale = A4, 1.0
            self.mx, self.mt, self.mb = 14 * mm, 12 * mm, 15 * mm
        self.width = self.pagesize[0] - 2 * self.mx
        self.frame_h = self.pagesize[1] - self.mt - self.mb

    def k(self, value):
        return round(value * self.scale, 2)

    @property
    def margins(self):
        return (self.mx, self.mx, self.mt, self.mb)


def _pairs(entries):
    """Normalise [(label, value), ...] (tuples, lists or dicts) and drop empty pairs."""
    out = []
    for entry in entries or []:
        if isinstance(entry, dict):
            label, value = entry.get('label'), entry.get('value')
        else:
            entry = list(entry) + ['', '']
            label, value = entry[0], entry[1]
        label, value = _s(label), _s(value)
        if label or value:
            out.append((label, value))
    return out


def _natural_width(markup, style, limit=10000):
    """Width of the longest line of shaped paragraph markup (works for Gujarati too)."""
    para = Para(markup, style)
    para.wrap(limit, 10 ** 6)
    return max(para.getActualLineWidths0() or [0])


def _business_header(business, title, L, status='', status_label=''):
    business = business or {}
    k = L.k

    right, right_need = [], 0
    if _s(title):
        title_style = _ps(k(18), bold=True, color=BRAND, align=TA_RIGHT, leading=k(21.5))
        right.append(_p(_s(title), title_style))
        right_need = _natural_width(rich(_s(title), bold=True), _ps(k(18), bold=True), L.width)
    if _s(status_label):
        color, fill = STATUS_COLORS.get(_s(status).lower(), (MUTED, SLATE_50))
        pill = Pill(_s(status_label), color, fill, k(7.5), align='RIGHT')
        right += [Spacer(1, k(5)), pill]
        right_need = max(right_need, pill.wrap(L.width * 0.42, 1000)[0])
    right_w = min(max(right_need + k(4), L.width * 0.24), L.width * 0.42)

    logo = _logo(business.get('logo_path'), k(42 * mm), k(22 * mm))
    logo_w = logo.drawWidth + k(10) if logo is not None else 0
    gap = k(10)
    info_w = L.width - logo_w - right_w - gap

    info = []
    name = _s(business.get('name'))
    if name:
        info.append(_p(name, _ps(k(16), bold=True, leading=k(19.5), space_after=k(1.5))))
    small = _ps(k(8.5), color=MUTED, leading=k(11.8))
    address = _s(business.get('address'))
    if address:
        info.append(_p(address, small))
    contact = []
    if _s(business.get('phone')):
        contact.append('Phone:&nbsp;' + rich(_keep_together(business.get('phone'))))
    if _s(business.get('email')):
        contact.append('Email:&nbsp;' + rich(_s(business.get('email'))))
    joined = '&nbsp;&nbsp;|&nbsp;&nbsp;'.join(contact)
    if len(contact) > 1 and _natural_width(joined, small) > info_w:
        info += [Para(part, small) for part in contact]
    elif contact:
        info.append(Para(joined, small))
    if _s(business.get('gstin')):
        info.append(Para('<b>GSTIN:</b>&nbsp;' + rich(_s(business.get('gstin'))),
                              _ps(k(8.5), leading=k(11.8))))

    if logo is not None:
        rows, widths = [[logo, info or '', '', right or '']], [logo_w, info_w, gap, right_w]
    else:
        rows, widths = [[info or '', '', right or '']], [info_w, gap, right_w]
    table = _plain_table(rows, widths, [('ALIGN', (-1, 0), (-1, 0), 'RIGHT')])
    return [table, _rule(BRAND, k(1.6), before=k(9), after=k(11))]


def _party_meta_block(party_label, party, meta, L):
    k = L.k
    party = party or {}
    pad = k(8)
    gap = k(10)
    left_w = (L.width - gap) * 0.56
    right_w = L.width - gap - left_w

    left = []
    if _s(party_label):
        left.append(_p(_s(party_label).upper(),
                       _ps(k(7.5), bold=True, color=BRAND, leading=k(10), space_after=k(3))))
    if _s(party.get('name')):
        left.append(_p(_s(party.get('name')), _ps(k(11), bold=True, leading=k(14), space_after=k(1.5))))
    line = _ps(k(8.5), color=MUTED, leading=k(11.8))
    if _s(party.get('phone')):
        left.append(Para('Phone:&nbsp;' + rich(_s(party.get('phone'))), line))
    if _s(party.get('address')):
        left.append(_p(_s(party.get('address')), line))
    if _s(party.get('gstin')):
        left.append(Para('<b>GSTIN:</b>&nbsp;' + rich(_s(party.get('gstin'))), _ps(k(8.5), leading=k(11.8))))

    rows = []
    label_style = _ps(k(8.5), color=MUTED, leading=k(12))
    value_style = _ps(k(8.5), bold=True, align=TA_RIGHT, leading=k(12))
    for label, value in _pairs(meta):
        rows.append([_p(label, label_style), _p(value, value_style)])
    inner_w = right_w - 2 * pad
    meta_table = ''
    if rows:
        meta_table = _plain_table(rows, [inner_w * 0.46, inner_w * 0.54], [
            ('TOPPADDING', (0, 0), (-1, -1), k(1.2)), ('BOTTOMPADDING', (0, 0), (-1, -1), k(1.2)),
            ('LEFTPADDING', (1, 0), (1, -1), k(4)),
        ])

    table = Table([[left or '', '', meta_table]], colWidths=[left_w, gap, right_w], splitInRow=30)
    table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), pad), ('RIGHTPADDING', (0, 0), (-1, -1), pad),
        ('TOPPADDING', (0, 0), (-1, -1), k(7)), ('BOTTOMPADDING', (0, 0), (-1, -1), k(7)),
        ('LEFTPADDING', (1, 0), (1, 0), 0), ('RIGHTPADDING', (1, 0), (1, 0), 0),
        ('BACKGROUND', (0, 0), (0, 0), SLATE_50),
        ('BOX', (0, 0), (0, 0), 0.6, BORDER),
        ('BOX', (2, 0), (2, 0), 0.6, BORDER),
    ]))
    return table


def _heading(text, L, keep_with_next=False):
    k = L.k
    return _p(_s(text).upper(), _ps(k(7.5), bold=True, color=BRAND, leading=k(10), space_after=k(2.5),
                                    keep_with_next=keep_with_next))


def _mini_table(header, rows, widths, L, aligns):
    """Compact bordered table used for payments, tax summary and allocations."""
    k = L.k
    size = k(8)
    head_styles = [_ps(k(7.5), bold=True, color=MUTED, align=a, leading=k(10)) for a in aligns]
    body_styles = [_ps(size, align=a, leading=size * 1.3) for a in aligns]
    data = [[_p(h, head_styles[i]) for i, h in enumerate(header)]]
    for row in rows:
        data.append([_p(_s(v), body_styles[i]) for i, v in enumerate(row)])
    table = Table(data, colWidths=widths, repeatRows=1, splitInRow=30, hAlign='LEFT')
    table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), k(4)), ('RIGHTPADDING', (0, 0), (-1, -1), k(4)),
        ('TOPPADDING', (0, 0), (-1, -1), k(2.6)), ('BOTTOMPADDING', (0, 0), (-1, -1), k(2.6)),
        ('BACKGROUND', (0, 0), (-1, 0), SLATE_50),
        ('LINEBELOW', (0, 0), (-1, -1), 0.5, BORDER),
        ('BOX', (0, 0), (-1, -1), 0.6, BORDER),
    ]))
    return table


def _kv_table(pairs, width, L, label_ratio=0.36):
    k = L.k
    label_style = _ps(k(8.2), color=MUTED, leading=k(11))
    value_style = _ps(k(8.2), bold=True, leading=k(11))
    rows = [[_p(label, label_style), _p(value, value_style)] for label, value in pairs]
    return _plain_table(rows, [width * label_ratio, width * (1 - label_ratio)], [
        ('TOPPADDING', (0, 0), (-1, -1), k(0.8)), ('BOTTOMPADDING', (0, 0), (-1, -1), k(0.8)),
        ('LEFTPADDING', (1, 0), (1, -1), k(4)),
    ])


def _bank_pairs(bank):
    if not isinstance(bank, dict):
        return []
    fields = (('bank_name', 'Bank Name'), ('account_name', 'Account Name'),
              ('account_number', 'Account No.'), ('ifsc', 'IFSC Code'), ('branch', 'Branch'),
              ('upi_id', 'UPI ID'))
    return [(label, _s(bank.get(key))) for key, label in fields if _s(bank.get(key))]


def _signature_block(business_name, L, width=None, in_cell=False):
    """Signature box. Use `in_cell=True` inside a table cell, where KeepTogether can't be
    used (its wrap() reports an unbounded height)."""
    k = L.k
    width = width or min(L.width * 0.42, k(210))
    rows = [
        [_p(('For ' + business_name) if business_name else '',
            _ps(k(8.5), bold=True, align=TA_CENTER, leading=k(11.5)))],
        [''],
        [_p('Authorised Signatory', _ps(k(8), color=MUTED, align=TA_CENTER, leading=k(10.5)))],
    ]
    table = Table(rows, colWidths=[width], rowHeights=[None, k(38), None], hAlign='RIGHT')
    table.setStyle(TableStyle([
        ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 2), (0, 2), k(3)),
        ('LINEABOVE', (0, 2), (0, 2), 0.7, MUTED),
    ]))
    if in_cell:
        return [Spacer(1, k(16)), table]
    return KeepTogether([Spacer(1, k(16)), table])


def _doc_info(doc, default_title):
    business = doc.get('business') or {}
    meta = _pairs(doc.get('meta'))
    number = meta[0][1] if meta else ''
    title = _s(doc.get('title')) or default_title
    return {'title': f'{title} {number}'.strip(), 'author': _s(business.get('name')),
            'subject': _s((doc.get('party') or {}).get('name'))}


class SideBySide(Flowable):
    """Left sections (lists of flowables) beside a right block such as the totals.

    A table row cannot break across pages, so when the block does not fit in
    the space left on the page, ``split`` keeps as many left sections as fit
    beside the right block and lets the remaining sections continue full width
    below (where paragraphs and tables can break normally).
    """

    def __init__(self, sections, right, left_w, gap, right_w, spacing):
        super().__init__()
        self.sections, self.right = list(sections), list(right)
        self.left_w, self.gap, self.right_w, self.spacing = left_w, gap, right_w, spacing
        self._table = None

    def _compose(self, count):
        left = []
        for index, section in enumerate(self.sections[:count]):
            if index:
                left.append(Spacer(1, self.spacing))
            left.extend(section)
        return _plain_table([[left or '', '', self.right or '']], [self.left_w, self.gap, self.right_w])

    def wrap(self, avail_w, avail_h):
        self._table = self._compose(len(self.sections))
        self.width, self.height = self._table.wrap(avail_w, avail_h)
        return self.width, self.height

    def split(self, avail_w, avail_h):
        for count in range(len(self.sections) - 1, -1, -1):
            table = self._compose(count)
            if table.wrap(avail_w, avail_h)[1] <= avail_h:
                rest = []
                for section in self.sections[count:]:
                    rest.append(Spacer(1, self.spacing))
                    rest.extend(section)
                return [table] + rest
        return []

    def draw(self):
        self._table.drawOn(self.canv, 0, 0)


def _side_by_side(left_sections, right_flowables, L, gap_ratio=0.05, left_ratio=0.55):
    gap = L.width * gap_ratio
    left_w = L.width * left_ratio
    return [SideBySide(left_sections, right_flowables, left_w, gap, L.width - left_w - gap, L.k(9))]


# --------------------------------------------------------------------------- #
# Invoice & receipt (A4 / A5)
# --------------------------------------------------------------------------- #
RUPEE = chr(0x20B9)
MUTED_HEX = '#475569'
FAINT_HEX = '#64748b'
_ALIGN = {'L': TA_LEFT, 'R': TA_RIGHT, 'C': TA_CENTER}


def _is_zero_amount(value):
    try:
        return D(_s(value).replace(RUPEE, '').replace(' ', '')) == 0
    except ValueError:
        return False


def _sum_amounts(values):
    """Sum pre-formatted amounts ('1,031.00'); '' when there are none or one is unparseable."""
    total, seen = Decimal('0'), False
    for value in values:
        text = _s(value).replace(RUPEE, '').replace(' ', '')
        if not text:
            continue
        try:
            total += D(text)
        except ValueError:
            return ''
        seen = True
    return fmt_money(total, symbol='') if seen else ''


def _brand_table(header, rows, widths, aligns, L, total_row=None):
    """Blue-header data table (items / allocations) with zebra rows and optional totals row."""
    k = L.k
    fs, pad, head_size = k(8.5), k(4.5), k(8)
    head = [_ps(head_size, bold=True, color=WHITE, align=_ALIGN[a], leading=head_size * 1.25) for a in aligns]
    data = [[_p(label, head[i]) for i, label in enumerate(header)]]
    data.extend(rows)
    count = len(rows)
    commands = [
        ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('VALIGN', (0, 0), (-1, 0), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), pad), ('RIGHTPADDING', (0, 0), (-1, -1), pad),
        ('TOPPADDING', (0, 0), (-1, -1), k(4.2)), ('BOTTOMPADDING', (0, 0), (-1, -1), k(4.2)),
        ('TOPPADDING', (0, 0), (-1, 0), k(5.5)), ('BOTTOMPADDING', (0, 0), (-1, 0), k(5.5)),
        ('BACKGROUND', (0, 0), (-1, 0), BRAND),
    ]
    if count:
        commands += [
            ('ROWBACKGROUNDS', (0, 1), (-1, count), [WHITE, SLATE_50]),
            ('LINEBELOW', (0, 1), (-1, count), 0.5, BORDER),
        ]
    if total_row is not None:
        data.append(total_row)
        last = len(data) - 1
        commands += [
            ('NOSPLIT', (0, max(1, last - 2)), (-1, last)),  # keep the totals row with the last items
            ('BACKGROUND', (0, last), (-1, last), BRAND_LIGHT),
            ('LINEABOVE', (0, last), (-1, last), 0.9, BRAND),
            ('LINEBELOW', (0, last), (-1, last), 0.9, BRAND),
        ]
    table = DataTable(data, colWidths=widths, repeatRows=1, splitInRow=40, hAlign='LEFT')
    table.setStyle(TableStyle(commands))
    return table


def _invoice_items_table(doc, items, L):
    k = L.k
    flags = doc.get('columns') or {}
    fs, small, pad, head_size = k(8.5), k(7), k(4.5), k(8)
    body = {a: _ps(fs, align=_ALIGN[a], leading=fs * 1.3) for a in 'LRC'}
    bold_right = _ps(fs, bold=True, align=TA_RIGHT, leading=fs * 1.3)
    name_style = _ps(fs, bold=True, leading=fs * 1.3)
    desc_style = _ps(small, color=MUTED, leading=small * 1.3)

    columns = [('sno', '#', 'C'), ('item', 'Item', 'L')]
    if flags.get('hsn'):
        columns.append(('hsn', 'HSN', 'L'))
    columns += [('qty', 'Qty', 'R'), ('rate', 'Rate', 'R')]
    if flags.get('discount'):
        columns.append(('discount', 'Disc.', 'R'))
    if flags.get('tax'):
        columns.append(('tax', 'Tax', 'R'))
    columns.append(('amount', 'Amount', 'R'))

    def qty_text(item):
        return ' '.join(part for part in (_s(item.get('qty')), _s(item.get('unit'))) if part)

    totals = {
        'qty': _s(doc.get('total_qty')),
        'discount': _sum_amounts(i.get('discount') for i in items) if flags.get('discount') else '',
        'tax': _sum_amounts(i.get('tax') for i in items) if flags.get('tax') else '',
        'amount': _sum_amounts(i.get('amount') for i in items),
    }
    show_totals = any(totals.values())

    def natural_width(key, label):
        texts = []
        for index, item in enumerate(items, 1):
            if key == 'sno':
                texts.append(_s(item.get('sno')) or str(index))
            elif key == 'qty':
                texts.append(qty_text(item))
            else:
                texts.append(_s(item.get(key)))
        widths = [_text_width(text, fs) for text in texts]
        if key in ('discount', 'tax'):
            widths += [_text_width(_s(item.get(key + '_label')), small) for item in items]
        if show_totals and totals.get(key):
            widths.append(_text_width(totals[key], fs, bold=True))
        widths.append(_text_width(label, head_size, bold=True))
        return max(widths) + 2 * pad + 1

    widths = {key: natural_width(key, label) for key, label, _ in columns if key != 'item'}
    if 'hsn' in widths:
        widths['hsn'] = min(widths['hsn'], L.width * 0.16)
    widths['qty'] = min(widths['qty'], L.width * 0.2)
    fixed = sum(widths.values())
    min_item = L.width * 0.3
    if L.width - fixed < min_item:
        factor = (L.width - min_item) / fixed
        widths = {key: value * factor for key, value in widths.items()}
        fixed = sum(widths.values())
    widths['item'] = L.width - fixed

    rows = []
    for index, item in enumerate(items, 1):
        row = []
        for key, _, align in columns:
            if key == 'sno':
                row.append(_p(_s(item.get('sno')) or str(index), body['C']))
            elif key == 'item':
                cell = [_p(_s(item.get('name')), name_style)]
                if _s(item.get('description')):
                    cell.append(_p(_s(item.get('description')), desc_style))
                row.append(cell)
            elif key == 'qty':
                markup = rich(_s(item.get('qty')))
                if _s(item.get('unit')):
                    markup += f' <font color="{MUTED_HEX}">{rich(_s(item.get("unit")))}</font>'
                row.append(Para(markup, body['R']))
            elif key in ('discount', 'tax'):
                markup = rich(_s(item.get(key)))
                label = _s(item.get(key + '_label'))
                if label:
                    markup += f'<br/><font size="{small}" color="{FAINT_HEX}">{rich(label)}</font>'
                row.append(Para(markup, body['R']))
            else:
                row.append(_p(_s(item.get(key)), body[align]))
        rows.append(row)

    total_row = None
    if show_totals:
        total_row = []
        for key, _, _ in columns:
            if key == 'item':
                total_row.append(_p('Total', _ps(fs, bold=True, leading=fs * 1.3)))
            elif totals.get(key):
                total_row.append(_p(totals[key], bold_right))
            else:
                total_row.append('')
    return _brand_table([label for _, label, _ in columns], rows,
                        [widths[key] for key, _, _ in columns], [a for _, _, a in columns], L, total_row)


def _amount_only_table(doc, L):
    """Bill saved with just a total: one 'Sale amount' / 'Purchase amount' row."""
    k = L.k
    fs = k(8.5)
    label = 'Purchase amount' if _s(doc.get('doc_type')) == 'purchase' else 'Sale amount'
    row = [_p('1', _ps(fs, align=TA_CENTER, leading=fs * 1.3)), _p(label, _ps(fs, leading=fs * 1.3)),
           _p(_s(doc.get('total')), _ps(fs, bold=True, align=TA_RIGHT, leading=fs * 1.3))]
    sno_w, amount_w = k(26), L.width * 0.3
    return _brand_table(['#', 'Particulars', 'Amount'], [row], [sno_w, L.width - sno_w - amount_w, amount_w],
                        ['C', 'L', 'R'], L)


def _is_zero_money(text):
    return not any(ch in '123456789' for ch in text)


def _invoice_totals(doc, L, width):
    k = L.k
    label_style = _ps(k(8.8), color=MUTED, leading=k(12))
    value_style = _ps(k(8.8), align=TA_RIGHT, leading=k(12))
    rows, commands = [], []
    for label, value in _pairs(doc.get('summary')):
        rows.append([_p(label, label_style), _p(value, value_style)])
    if rows:
        commands.append(('LINEBELOW', (0, 0), (-1, len(rows) - 1), 0.4, BORDER))

    grand = len(rows)
    size = k(11)
    rows.append([_p('Grand Total', _ps(size, bold=True, color=WHITE, leading=size * 1.25)),
                 _p(_s(doc.get('total')), _ps(size, bold=True, color=WHITE, align=TA_RIGHT, leading=size * 1.25))])
    commands += [('BACKGROUND', (0, grand), (-1, grand), BRAND),
                 ('TOPPADDING', (0, grand), (-1, grand), k(6)), ('BOTTOMPADDING', (0, grand), (-1, grand), k(6))]

    if _s(doc.get('paid_label')) or _s(doc.get('paid')):
        rows.append([_p(_s(doc.get('paid_label')), label_style), _p(_s(doc.get('paid')), value_style)])
    party_balances = _pairs(doc.get('party_balances'))

    def highlight(label, value, color):
        index = len(rows)
        size = k(10)
        rows.append([_p(label, _ps(size, bold=True, color=color, leading=size * 1.3)),
                     _p(value, _ps(size, bold=True, color=color, align=TA_RIGHT, leading=size * 1.3))])
        commands.extend([('BACKGROUND', (0, index), (-1, index), SLATE_50),
                         ('LINEABOVE', (0, index), (-1, index), 0.8, BORDER),
                         ('LINEBELOW', (0, index), (-1, index), 0.8, BORDER),
                         ('TOPPADDING', (0, index), (-1, index), k(5)),
                         ('BOTTOMPADDING', (0, index), (-1, index), k(5))])

    if _s(doc.get('balance_label')) or _s(doc.get('balance')):
        if party_balances:
            rows.append([_p(_s(doc.get('balance_label')), _ps(k(8.8), bold=True, leading=k(12))),
                         _p(_s(doc.get('balance')), _ps(k(8.8), bold=True, align=TA_RIGHT, leading=k(12)))])
        else:
            highlight(_s(doc.get('balance_label')), _s(doc.get('balance')),
                      STATUS_COLORS.get(_s(doc.get('status')).lower(), (TEXT, SLATE_50))[0])
    for i, (label, value) in enumerate(party_balances):
        if i == len(party_balances) - 1:
            highlight(label, value, TEXT if _is_zero_money(value) else RED)
            continue
        if i == 0:
            commands.append(('TOPPADDING', (0, len(rows)), (-1, len(rows)), k(8)))
        rows.append([_p(label, label_style), _p(value, _ps(k(8.8), bold=True, align=TA_RIGHT, leading=k(12)))])

    table = Table(rows, colWidths=[width * 0.46, width * 0.54], hAlign='RIGHT')
    table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), k(7)), ('RIGHTPADDING', (0, 0), (-1, -1), k(7)),
        ('TOPPADDING', (0, 0), (-1, -1), k(3.2)), ('BOTTOMPADDING', (0, 0), (-1, -1), k(3.2)),
    ] + commands))
    return table


def _invoice_sections(doc, L, width):
    k = L.k
    body = _ps(k(8.5), leading=k(12))
    sections = []
    if _s(doc.get('amount_in_words')):
        sections.append([_heading('Amount in Words', L),
                         _p(_s(doc.get('amount_in_words')), _ps(k(8.8), leading=k(12)))])
    payments = [p for p in (doc.get('payments') or []) if isinstance(p, dict)]
    if payments:
        rows = [[p.get('number'), p.get('date'), p.get('mode'), p.get('amount')] for p in payments]
        sections.append([_heading('Payment History', L, keep_with_next=True),
                         _mini_table(['No.', 'Date', 'Mode', 'Amount'], rows,
                                     [width * 0.27, width * 0.22, width * 0.25, width * 0.26], L,
                                     [TA_LEFT, TA_LEFT, TA_LEFT, TA_RIGHT])])
    bank = _bank_pairs(doc.get('bank'))
    if bank:
        sections.append([_heading('Bank Details', L, keep_with_next=True), _kv_table(bank, width, L)])
    if _s(doc.get('notes')):
        sections.append([_heading('Description / Notes', L, keep_with_next=True), _p(_s(doc.get('notes')), body)])
    if _s(doc.get('terms')):
        sections.append([_heading('Terms & Conditions', L, keep_with_next=True), _p(_s(doc.get('terms')), body)])
    tax_rows = [[t.get('rate'), t.get('taxable'), t.get('tax')]
                for t in (doc.get('tax_summary') or []) if isinstance(t, dict)]
    if tax_rows:
        sections.append([_heading('Tax Summary', L, keep_with_next=True),
                         _mini_table(['Tax Rate', 'Taxable Amount', 'Tax Amount'], tax_rows,
                                     [width * 0.28, width * 0.38, width * 0.34], L,
                                     [TA_LEFT, TA_RIGHT, TA_RIGHT])])
    return sections


def _invoice_story_full(doc, L):
    business = doc.get('business') or {}
    story = _business_header(business, doc.get('title'), L, doc.get('status'), doc.get('status_label'))
    story.append(_party_meta_block(doc.get('party_label'), doc.get('party'), doc.get('meta'), L))
    story.append(Spacer(1, L.k(12)))
    items = [item for item in (doc.get('items') or []) if isinstance(item, dict)]
    story.append(_invoice_items_table(doc, items, L) if items else _amount_only_table(doc, L))
    story.append(Spacer(1, L.k(12)))
    left_ratio, gap_ratio = 0.55, 0.05
    right_w = L.width * (1 - left_ratio - gap_ratio)
    right = [_invoice_totals(doc, L, right_w)]
    if doc.get('show_signature'):
        # under the totals, where the right column is otherwise empty
        right += _signature_block(_s(business.get('name')), L, width=right_w, in_cell=True)
    story += _side_by_side(_invoice_sections(doc, L, L.width * left_ratio), right, L, gap_ratio, left_ratio)
    # footer_note is drawn in the last page's footer (see render_invoice_pdf) so it never
    # pushes onto a page of its own
    return story


def _right_pairs(pairs, L, width, emphasise_last=False):
    k = L.k
    label_style = _ps(k(9), color=MUTED, leading=k(12.5))
    value_style = _ps(k(9), bold=True, align=TA_RIGHT, leading=k(12.5))
    rows = [[_p(label, label_style), _p(value, value_style)] for label, value in pairs]
    commands = [
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), k(7)), ('RIGHTPADDING', (0, 0), (-1, -1), k(7)),
        ('TOPPADDING', (0, 0), (-1, -1), k(4)), ('BOTTOMPADDING', (0, 0), (-1, -1), k(4)),
        ('LINEBELOW', (0, 0), (-1, -1), 0.5, BORDER),
    ]
    if emphasise_last and rows:
        commands.append(('BACKGROUND', (0, len(rows) - 1), (-1, len(rows) - 1), SLATE_50))
    table = Table(rows, colWidths=[width * 0.48, width * 0.52], hAlign='RIGHT')
    table.setStyle(TableStyle(commands))
    return table


def _amount_box(doc, L):
    k = L.k
    label = 'Amount Paid' if _s(doc.get('doc_type')) == 'payment_out' else 'Amount Received'
    cell = [_p(label.upper(), _ps(k(7.5), bold=True, color=BRAND, leading=k(10), space_after=k(2))),
            _p(_s(doc.get('amount')), _ps(k(22), bold=True, leading=k(27)))]
    if _s(doc.get('amount_in_words')):
        cell.append(_p(_s(doc.get('amount_in_words')), _ps(k(9), color=MUTED, leading=k(12.5), space_before=k(1))))
    table = Table([[cell]], colWidths=[L.width], hAlign='LEFT')
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), BRAND_LIGHT),
        ('LINEBEFORE', (0, 0), (0, 0), k(3.5), BRAND),
        ('LEFTPADDING', (0, 0), (-1, -1), k(14)), ('RIGHTPADDING', (0, 0), (-1, -1), k(12)),
        ('TOPPADDING', (0, 0), (-1, -1), k(10)), ('BOTTOMPADDING', (0, 0), (-1, -1), k(11)),
    ]))
    return table


def _receipt_story_full(doc, L):
    k = L.k
    business = doc.get('business') or {}
    story = _business_header(business, doc.get('title'), L)
    story.append(_party_meta_block(doc.get('party_label'), doc.get('party'), doc.get('meta'), L))
    story.append(Spacer(1, k(12)))
    story.append(_amount_box(doc, L))

    allocations = [a for a in (doc.get('allocations') or []) if isinstance(a, dict)]
    if allocations:
        fs = k(8.5)
        left, right = _ps(fs, leading=fs * 1.3), _ps(fs, align=TA_RIGHT, leading=fs * 1.3)
        bold_right = _ps(fs, bold=True, align=TA_RIGHT, leading=fs * 1.3)
        rows = [[_p(_s(a.get('number')), left), _p(_s(a.get('date')), left),
                 _p(_s(a.get('bill_total')), right), _p(_s(a.get('amount')), bold_right)] for a in allocations]
        w = L.width
        story += [Spacer(1, k(14)), _heading('Payment applied to bills', L, keep_with_next=True),
                  _brand_table(['Bill No.', 'Bill Date', 'Bill Total', 'Amount Applied'], rows,
                               [w * 0.28, w * 0.22, w * 0.25, w * 0.25], ['L', 'L', 'R', 'R'], L)]

    pairs = []
    if _s(doc.get('unallocated_label')) or _s(doc.get('unallocated')):
        pairs.append((_s(doc.get('unallocated_label')), _s(doc.get('unallocated'))))
    if _s(doc.get('party_balance_label')) or _s(doc.get('party_balance')):
        pairs.append((_s(doc.get('party_balance_label')), _s(doc.get('party_balance'))))
    if pairs:
        story += [Spacer(1, k(12)), _right_pairs(pairs, L, L.width * 0.5)]
    if _s(doc.get('notes')):
        story += [Spacer(1, k(12)), _heading('Notes', L, keep_with_next=True),
                  _p(_s(doc.get('notes')), _ps(k(8.5), leading=k(12)))]
    if doc.get('show_signature'):
        story.append(_signature_block(_s(business.get('name')), L))
    return story


# --------------------------------------------------------------------------- #
# Thermal roll layouts (80 mm / 58 mm)
# --------------------------------------------------------------------------- #
TIMES = chr(0xD7)


class _Thermal:
    def __init__(self, fmt):
        narrow = fmt == 'thermal58'
        self.page_w = THERMAL_WIDTHS[fmt]
        self.margin = (3.5 if narrow else 4) * mm
        self.width = self.page_w - 2 * self.margin
        self.base = 7 if narrow else 8
        self.small = 6.2 if narrow else 7
        self.name = 9.5 if narrow else 11.5
        self.title = 8.5 if narrow else 9.5
        self.total = 9 if narrow else 10.5


def _ts(T, size=None, bold=False, align=TA_LEFT, space_after=0, space_before=0):
    size = size or T.base
    return _ps(size, bold=bold, color=BLACK, align=align, leading=round(size * 1.28, 2),
               space_after=space_after, space_before=space_before)


def _t_dash(before=3, after=3):
    return _rule(BLACK, 0.6, before=before, after=after, dash=(1.6, 1.4))


def _t_table(rows, T, ratios=(0.6, 0.4), commands=()):
    base = [('TOPPADDING', (0, 0), (-1, -1), 0.7), ('BOTTOMPADDING', (0, 0), (-1, -1), 0.7),
            ('LEFTPADDING', (1, 0), (1, -1), 3)]
    return _plain_table(rows, [T.width * ratios[0], T.width * ratios[1]], base + list(commands))


def _t_pair(label, value, T, bold=False, size=None):
    return [_p(label, _ts(T, size, bold)), _p(value, _ts(T, size, bold, TA_RIGHT))]


def _thermal_header(business, doc_title, T, status_label=''):
    business = business or {}
    center_small = _ts(T, T.small, align=TA_CENTER)
    story = []
    logo = _logo(business.get('logo_path'), T.width * 0.5, 14 * mm, align='CENTER')
    if logo is not None:
        story += [logo, Spacer(1, 3)]
    if _s(business.get('name')):
        story.append(_p(_s(business.get('name')), _ts(T, T.name, bold=True, align=TA_CENTER, space_after=1)))
    if _s(business.get('address')):
        story.append(_p(_s(business.get('address')), center_small))
    if _s(business.get('phone')):
        story.append(Para('Phone:&nbsp;' + rich(_keep_together(business.get('phone'))), center_small))
    if _s(business.get('email')):
        story.append(_p(_s(business.get('email')), center_small))
    if _s(business.get('gstin')):
        story.append(Para('<b>GSTIN:</b>&nbsp;' + rich(_s(business.get('gstin'))), center_small))
    story.append(_t_dash(4, 4))
    if _s(doc_title):
        story.append(_p(_s(doc_title), _ts(T, T.title, bold=True, align=TA_CENTER)))
    if _s(status_label):
        story += [Spacer(1, 2.5), Pill(_s(status_label), BLACK, WHITE, T.small, align='CENTER')]
    story.append(Spacer(1, 4))
    return story


def _thermal_party_meta(doc, T):
    story = []
    meta = _pairs(doc.get('meta'))
    if meta:
        story.append(_t_table([_t_pair(label, value, T) for label, value in meta], T, (0.45, 0.55)))
    party = doc.get('party') or {}
    lines = []
    name = _s(party.get('name'))
    if _s(doc.get('party_label')) or name:
        label = _s(doc.get('party_label'))
        markup = (f'<b>{rich(label, bold=True)}:</b> ' if label else '') + rich(name, bold=True)
        lines.append(Para(markup, _ts(T, bold=True)))
    small = _ts(T, T.small)
    if _s(party.get('phone')):
        lines.append(Para('Phone:&nbsp;' + rich(_s(party.get('phone'))), small))
    if _s(party.get('address')):
        lines.append(_p(_s(party.get('address')), small))
    if _s(party.get('gstin')):
        lines.append(Para('GSTIN:&nbsp;' + rich(_s(party.get('gstin'))), small))
    if lines:
        story += [Spacer(1, 3)] + lines
    return story


def _thermal_items(doc, items, T):
    flags = doc.get('columns') or {}
    small = _ts(T, T.small)
    rows, commands = [], []

    def span_row(flowable):
        rows.append([flowable, ''])
        commands.append(('SPAN', (0, len(rows) - 1), (1, len(rows) - 1)))

    for index, item in enumerate(items, 1):
        sno = _s(item.get('sno')) or str(index)
        span_row(_p(f'{sno}. {_s(item.get("name"))}', _ts(T, bold=True)))
        if _s(item.get('description')):
            span_row(_p(_s(item.get('description')), small))
        qty = ' '.join(part for part in (_s(item.get('qty')), _s(item.get('unit'))) if part)
        rate = _s(item.get('rate'))
        calc = f'{qty} {TIMES} {rate}' if qty and rate else (qty or rate)
        rows.append([_p(calc, _ts(T)), _p(_s(item.get('amount')), _ts(T, bold=True, align=TA_RIGHT))])
        extras = []
        if flags.get('hsn') and _s(item.get('hsn')):
            extras.append('HSN: ' + _s(item.get('hsn')))
        for key, word in (('discount', 'Disc'), ('tax', 'Tax')):
            if flags.get(key) and _s(item.get(key)) and not _is_zero_amount(item.get(key)):
                label = _s(item.get(key + '_label'))
                extras.append(f'{word}{" " + label if label else ""}: {_s(item.get(key))}')
        if extras:
            span_row(Para(f'&nbsp;&nbsp;{chr(0xB7)}&nbsp;&nbsp;'.join(rich(e) for e in extras), small))
        commands.append(('BOTTOMPADDING', (0, len(rows) - 1), (-1, len(rows) - 1), 3))
    head = _t_table([[_p('Item', _ts(T, bold=True)), _p('Amount', _ts(T, bold=True, align=TA_RIGHT))]], T, (0.62, 0.38))
    return [head, _t_dash(2, 3), _t_table(rows, T, (0.62, 0.38), commands)]


def _thermal_totals(doc, T):
    rows, commands = [], []
    if _s(doc.get('total_qty')):
        rows.append(_t_pair('Total Qty', _s(doc.get('total_qty')), T))
    for label, value in _pairs(doc.get('summary')):
        rows.append(_t_pair(label, value, T))
    index = len(rows)
    rows.append(_t_pair('Grand Total', _s(doc.get('total')), T, bold=True, size=T.total))
    commands += [('LINEABOVE', (0, index), (-1, index), 0.8, BLACK), ('LINEBELOW', (0, index), (-1, index), 0.8, BLACK),
                 ('TOPPADDING', (0, index), (-1, index), 3), ('BOTTOMPADDING', (0, index), (-1, index), 3)]
    if _s(doc.get('paid_label')) or _s(doc.get('paid')):
        rows.append(_t_pair(_s(doc.get('paid_label')), _s(doc.get('paid')), T))
        commands.append(('TOPPADDING', (0, index + 1), (-1, index + 1), 2.5))
    party_balances = _pairs(doc.get('party_balances'))
    if _s(doc.get('balance_label')) or _s(doc.get('balance')):
        rows.append(_t_pair(_s(doc.get('balance_label')), _s(doc.get('balance')), T, bold=not party_balances))
    for i, (label, value) in enumerate(party_balances):
        if i == 0:
            commands.append(('LINEABOVE', (0, len(rows)), (-1, len(rows)), 0.5, BLACK))
            commands.append(('TOPPADDING', (0, len(rows)), (-1, len(rows)), 3))
        rows.append(_t_pair(label, value, T, bold=i == len(party_balances) - 1))
    return _t_table(rows, T, (0.5, 0.5), commands)


def _thermal_text_block(title, text, T):
    return [Spacer(1, 3), _p(title, _ts(T, T.small, bold=True)), _p(text, _ts(T, T.small))]


def _thermal_tail(doc, T, business):
    story = []
    if doc.get('show_signature'):
        story += [Spacer(1, 6), _p(('For ' + _s(business.get('name'))) if _s(business.get('name')) else '',
                                   _ts(T, T.small, bold=True, align=TA_CENTER)),
                  Spacer(1, 22), _rule(BLACK, 0.5),
                  _p('Authorised Signatory', _ts(T, T.small, align=TA_CENTER, space_before=1.5))]
    if _s(doc.get('footer_note')):
        story += [_t_dash(5, 4), _p(_s(doc.get('footer_note')), _ts(T, bold=True, align=TA_CENTER))]
    return story


def _thermal_invoice_story(doc, T):
    business = doc.get('business') or {}
    story = _thermal_header(business, doc.get('title'), T, doc.get('status_label'))
    story += _thermal_party_meta(doc, T)
    story.append(_t_dash(4, 3))
    items = [item for item in (doc.get('items') or []) if isinstance(item, dict)]
    if items:
        story += _thermal_items(doc, items, T)
    else:
        label = 'Purchase amount' if _s(doc.get('doc_type')) == 'purchase' else 'Sale amount'
        story.append(_t_table([_t_pair(label, _s(doc.get('total')), T)], T))
    story.append(_t_dash(2, 3))
    story.append(_thermal_totals(doc, T))
    if _s(doc.get('amount_in_words')):
        story.append(_p(_s(doc.get('amount_in_words')), _ts(T, T.small, space_before=3)))

    payments = [p for p in (doc.get('payments') or []) if isinstance(p, dict)]
    if payments:
        rows = []
        for p in payments:
            parts = (_s(p.get('number')), _s(p.get('date')), _s(p.get('mode')))
            left = f' {chr(0xB7)} '.join(rich(part) for part in parts if part)
            rows.append([Para(left, _ts(T, T.small)),
                         _p(_s(p.get('amount')), _ts(T, T.small, align=TA_RIGHT))])
        story += [_t_dash(3, 2), _p('Payment History', _ts(T, T.small, bold=True)), _t_table(rows, T, (0.64, 0.36))]
    bank = _bank_pairs(doc.get('bank'))
    if bank:
        story += [_t_dash(3, 2), _p('Bank Details', _ts(T, T.small, bold=True)),
                  _t_table([[_p(label, _ts(T, T.small)), _p(value, _ts(T, T.small, bold=True))] for label, value in bank],
                           T, (0.36, 0.64))]
    tax_rows = [t for t in (doc.get('tax_summary') or []) if isinstance(t, dict)]
    if tax_rows:
        small, small_r = _ts(T, T.small, bold=True), _ts(T, T.small, bold=True, align=TA_RIGHT)
        rows = [[_p('Rate', small), _p('Taxable', small_r), _p('Tax', small_r)]]
        rows += [[_p(_s(t.get('rate')), _ts(T, T.small)), _p(_s(t.get('taxable')), _ts(T, T.small, align=TA_RIGHT)),
                  _p(_s(t.get('tax')), _ts(T, T.small, align=TA_RIGHT))] for t in tax_rows]
        widths = [T.width * 0.26, T.width * 0.40, T.width * 0.34]
        story += [_t_dash(3, 2), _p('Tax Summary', _ts(T, T.small, bold=True)),
                  _plain_table(rows, widths, [('TOPPADDING', (0, 0), (-1, -1), 0.6),
                                              ('BOTTOMPADDING', (0, 0), (-1, -1), 0.6)])]
    if _s(doc.get('notes')) or _s(doc.get('terms')):
        story.append(_t_dash(3, 1))
        if _s(doc.get('notes')):
            story += _thermal_text_block('Notes', _s(doc.get('notes')), T)
        if _s(doc.get('terms')):
            story += _thermal_text_block('Terms & Conditions', _s(doc.get('terms')), T)
    story += _thermal_tail(doc, T, business)
    return story


def _thermal_receipt_story(doc, T):
    business = doc.get('business') or {}
    story = _thermal_header(business, doc.get('title'), T)
    story += _thermal_party_meta(doc, T)
    story.append(_t_dash(4, 4))
    label = 'Amount Paid' if _s(doc.get('doc_type')) == 'payment_out' else 'Amount Received'
    story += [_p(label.upper(), _ts(T, T.small, bold=True, align=TA_CENTER)),
              _p(_s(doc.get('amount')), _ts(T, T.total + 3, bold=True, align=TA_CENTER, space_before=1))]
    if _s(doc.get('amount_in_words')):
        story.append(_p(_s(doc.get('amount_in_words')), _ts(T, T.small, align=TA_CENTER, space_before=1.5)))

    allocations = [a for a in (doc.get('allocations') or []) if isinstance(a, dict)]
    if allocations:
        rows, commands = [], []
        for a in allocations:
            left = _s(a.get('number')) + (f' ({_s(a.get("date"))})' if _s(a.get('date')) else '')
            rows.append([_p(left, _ts(T)), _p(_s(a.get('amount')), _ts(T, bold=True, align=TA_RIGHT))])
            if _s(a.get('bill_total')):
                rows.append([_p('Bill total: ' + _s(a.get('bill_total')), _ts(T, T.small)), ''])
                commands.append(('SPAN', (0, len(rows) - 1), (1, len(rows) - 1)))
            commands.append(('BOTTOMPADDING', (0, len(rows) - 1), (-1, len(rows) - 1), 2.5))
        story += [_t_dash(4, 2), _p('Payment applied to bills', _ts(T, T.small, bold=True, space_after=1.5)),
                  _t_table(rows, T, (0.62, 0.38), commands)]

    pairs = []
    if _s(doc.get('unallocated_label')) or _s(doc.get('unallocated')):
        pairs.append((_s(doc.get('unallocated_label')), _s(doc.get('unallocated'))))
    if _s(doc.get('party_balance_label')) or _s(doc.get('party_balance')):
        pairs.append((_s(doc.get('party_balance_label')), _s(doc.get('party_balance'))))
    if pairs:
        story += [_t_dash(3, 2), _t_table([_t_pair(label, value, T) for label, value in pairs], T, (0.45, 0.55))]
    if _s(doc.get('notes')):
        story += [_t_dash(3, 1)] + _thermal_text_block('Notes', _s(doc.get('notes')), T)
    story += _thermal_tail(doc, T, business)
    return story


# --------------------------------------------------------------------------- #
# Public: invoices & receipts
# --------------------------------------------------------------------------- #
def render_invoice_pdf(doc: dict, fmt: str = 'a4') -> bytes:
    """Sale invoice / purchase bill as PDF bytes. ``fmt``: a4 | a5 | thermal80 | thermal58."""
    doc = doc if isinstance(doc, dict) else {}
    fmt = _normalise_fmt(fmt)
    register_fonts()
    info = _doc_info(doc, 'Invoice')
    with _render_lock:
        if fmt in THERMAL_WIDTHS:
            T = _Thermal(fmt)
            return _build_fitted(lambda: _thermal_invoice_story(doc, T), T.page_w, T.margin, info)
        L = _Layout(fmt)
        return _build(_invoice_story_full(doc, L), L.pagesize, L.margins,
                      footer=_page_footer(L.k(7.5), L.mx, L.mb, last_page_note=_s(doc.get('footer_note'))),
                      info=info)


def render_receipt_pdf(doc: dict, fmt: str = 'a4') -> bytes:
    """Payment-in receipt / payment-out voucher as PDF bytes."""
    doc = doc if isinstance(doc, dict) else {}
    fmt = _normalise_fmt(fmt)
    register_fonts()
    info = _doc_info(doc, 'Receipt')
    with _render_lock:
        if fmt in THERMAL_WIDTHS:
            T = _Thermal(fmt)
            return _build_fitted(lambda: _thermal_receipt_story(doc, T), T.page_w, T.margin, info)
        L = _Layout(fmt)
        return _build(_receipt_story_full(doc, L), L.pagesize, L.margins,
                      footer=_page_footer(L.k(7.5), L.mx, L.mb, last_page_note=_s(doc.get('footer_note'))),
                      info=info)


# --------------------------------------------------------------------------- #
# Reports & statements
# --------------------------------------------------------------------------- #
DEFAULT_WEIGHTS = {'date': 1.1, 'text': 2.0, 'multiline': 2.4, 'money': 1.3, 'balance': 1.5,
                   'qty': 0.8, 'number': 0.8}
NUMERIC_TYPES = ('money', 'balance', 'qty', 'number')
WRAPPING_TYPES = ('text', 'multiline')
NO_RECORDS = 'No records for the selected period.'


def _to_decimal(value):
    if value is None or value == '' or isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        return value
    try:
        return D(value)
    except (ValueError, TypeError, ArithmeticError):
        return None


def format_value(value, value_type, symbol=False):
    """Display text for a report value: money '1,23,456.00', balance '1,234.00 Dr', qty '2.5', dd/mm/yyyy."""
    if value is None or value == '':
        return ''
    value_type = (value_type or 'text').lower()
    if value_type in ('money', 'balance'):
        amount = _to_decimal(value)
        if amount is None:
            return _clean(value)
        sym = RUPEE if symbol else ''
        if value_type == 'money':
            return fmt_money(amount, symbol=sym)
        rounded = q2(amount)
        if rounded == 0:
            return fmt_money(0, symbol=sym)
        return fmt_money(abs(rounded), symbol=sym) + (' Dr' if rounded > 0 else ' Cr')
    if value_type == 'qty':
        amount = _to_decimal(value)
        return fmt_qty(amount) if amount is not None else _clean(value)
    if value_type == 'number':
        try:
            return str(int(value))
        except (TypeError, ValueError, ArithmeticError):
            return _clean(value)
    if value_type == 'date':
        return fmt_date(value) if hasattr(value, 'strftime') else _clean(value)
    return _clean(value)


class _ReportLayout:
    def __init__(self, orientation):
        self.landscape = orientation == 'landscape'
        self.pagesize = landscape(A4) if self.landscape else portrait(A4)
        self.mx, self.mt, self.mb = 12 * mm, 11 * mm, 14 * mm
        self.width = self.pagesize[0] - 2 * self.mx

    @property
    def margins(self):
        return (self.mx, self.mx, self.mt, self.mb)


def _report_header(report, R):
    business = report.get('business') or {}
    details = []
    lines = (line.strip().rstrip(',').strip() for line in _s(business.get('address')).splitlines())
    address = ', '.join(line for line in lines if line)
    if address:
        details.append(rich(address))
    if _s(business.get('phone')):
        details.append('Phone:&nbsp;' + rich(_keep_together(business.get('phone'))))
    if _s(business.get('gstin')):
        details.append('GSTIN:&nbsp;' + rich(_s(business.get('gstin'))))
    left = []
    if _s(business.get('name')):
        left.append(_p(_s(business.get('name')), _ps(13, bold=True, leading=16)))
    if details:
        left.append(Para('&nbsp;&nbsp;|&nbsp;&nbsp;'.join(details), _ps(8, color=MUTED, leading=11)))
    right = []
    if _s(report.get('generated_at')):
        right = [_p('Generated on', _ps(7, color=FAINT, align=TA_RIGHT, leading=9)),
                 _p(_s(report.get('generated_at')), _ps(8.5, align=TA_RIGHT, leading=11))]
    story = [_plain_table([[left or '', right or '']], [R.width * 0.74, R.width * 0.26]),
             _rule(BRAND, 1.2, before=7, after=9)]
    if _s(report.get('title')):
        story.append(_p(_s(report.get('title')), _ps(15, bold=True, leading=19)))
    if _s(report.get('subtitle')):
        story.append(_p(_s(report.get('subtitle')), _ps(9, color=MUTED, leading=12.5)))
    story.append(Spacer(1, 9))
    return story


def _report_info(report, R):
    pairs = _pairs(report.get('info'))
    if not pairs:
        return []
    gap, pad = 14, 7
    col_w = (R.width - gap - 4 * pad) / 2
    label_w = min(max(_text_width(label, 8, bold=True) for label, _ in pairs) + 10, col_w * 0.42)
    label_style = _ps(8, bold=True, color=MUTED, leading=11)
    value_style = _ps(8.5, leading=11.5)
    rows = []
    for start in range(0, len(pairs), 2):
        row = []
        for label, value in pairs[start:start + 2]:
            row += [_p(label, label_style), _p(value, value_style)]
        row += [''] * (4 - len(row))
        row.insert(2, '')
        rows.append(row)
    table = Table(rows, colWidths=[label_w + pad, col_w - label_w + pad, gap, label_w + pad, col_w - label_w + pad],
                  hAlign='LEFT', splitInRow=30)
    table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('LEFTPADDING', (0, 0), (0, -1), pad), ('LEFTPADDING', (3, 0), (3, -1), pad),
        ('RIGHTPADDING', (1, 0), (1, -1), pad), ('RIGHTPADDING', (4, 0), (4, -1), pad),
        ('TOPPADDING', (0, 0), (-1, -1), 2.2), ('BOTTOMPADDING', (0, 0), (-1, -1), 2.2),
        ('TOPPADDING', (0, 0), (-1, 0), 6), ('BOTTOMPADDING', (0, -1), (-1, -1), 6),
        ('BACKGROUND', (0, 0), (-1, -1), SLATE_50),
        ('BOX', (0, 0), (-1, -1), 0.6, BORDER),
    ]))
    return [table, Spacer(1, 9)]


def _report_summary(report, R):
    cards = []
    for entry in report.get('summary') or []:
        if not isinstance(entry, dict):
            continue
        value_type = (_s(entry.get('type')) or 'text').lower()
        text = format_value(entry.get('value'), value_type, symbol=True)
        color = TEXT
        if value_type == 'balance':
            amount = _to_decimal(entry.get('value'))
            if amount is not None and q2(amount) != 0:
                color = GREEN if amount > 0 else RED
        tone = _s(entry.get('tone')).lower()
        if tone in ('pos', 'neg'):
            color = GREEN if tone == 'pos' else RED
        cards.append([_p(_s(entry.get('label')).upper(), _ps(7, bold=True, color=FAINT, leading=9.5, space_after=2)),
                      _p(text, _ps(11.5, bold=True, color=color, leading=14.5))])
    if not cards:
        return []
    max_per_row = 5 if R.landscape else 4
    row_count = -(-len(cards) // max_per_row)
    per_row = count = -(-len(cards) // row_count)  # balance cards across rows (5 -> 3 + 2)
    gap = 8
    card_w = (R.width - gap * (count - 1)) / count
    story = []
    for start in range(0, len(cards), per_row):
        row, widths = [], []
        commands = [('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                    ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0)]
        for index, card in enumerate(cards[start:start + per_row]):
            if index:
                row.append('')
                widths.append(gap)
            col = len(row)
            row.append(card)
            widths.append(card_w)
            commands += [('BACKGROUND', (col, 0), (col, 0), SLATE_50), ('BOX', (col, 0), (col, 0), 0.6, BORDER),
                         ('LINEBEFORE', (col, 0), (col, 0), 2.5, BRAND),
                         ('LEFTPADDING', (col, 0), (col, 0), 9), ('RIGHTPADDING', (col, 0), (col, 0), 7),
                         ('TOPPADDING', (col, 0), (col, 0), 6), ('BOTTOMPADDING', (col, 0), (col, 0), 7)]
        table = Table([row], colWidths=widths, hAlign='LEFT')
        table.setStyle(TableStyle(commands))
        story += [table, Spacer(1, gap)]
    story.append(Spacer(1, 3))
    return story


def _fit_column_widths(total, weights, needs):
    """Widths proportional to ``weights``; a column narrower than its need grows to it and the
    extra room is taken proportionally from columns wider than their needs.

    Returns None when the needs cannot all be met at this font size.
    """
    widths = [total * w / sum(weights) for w in weights]
    deficit = sum(max(0.0, need - width) for need, width in zip(needs, widths))
    if deficit <= 0.01:
        return widths
    spare = [max(0.0, width - need) for need, width in zip(needs, widths)]
    available = sum(spare)
    if available + 0.01 < deficit:
        return None
    return [max(need, width) - (deficit * s / available if s else 0.0)
            for need, width, s in zip(needs, widths, spare)]


def _longest_word_width(texts):
    """Width at 1pt of the widest single word (so wrapping columns never split words needlessly)."""
    best, seen = 0.0, set()
    for text in texts:
        if not text:
            continue
        for word in text.split():
            if word not in seen:
                seen.add(word)
                best = max(best, stringWidth(word, GUJ_FONT if _GUJ_ANY_RE.search(word) else FONT, 1))
    return best


def _report_table(report, R):
    columns = [c for c in (report.get('columns') or []) if isinstance(c, dict)]
    rows = [r for r in (report.get('rows') or []) if isinstance(r, dict)]
    totals = report.get('totals') if isinstance(report.get('totals'), dict) else None
    if not columns:
        return [_p(NO_RECORDS, _ps(9, color=MUTED, align=TA_CENTER, leading=12))]

    keys = [c.get('key') for c in columns]
    types = [(_s(c.get('type')) or 'text').lower() for c in columns]
    labels = [_s(c.get('label')) for c in columns]
    wrapping = [t in WRAPPING_TYPES for t in types]
    numeric = [t in NUMERIC_TYPES for t in types]
    weights = []
    for column, value_type in zip(columns, types):
        try:
            weight = float(column.get('width') or 0)
        except (TypeError, ValueError):
            weight = 0
        weights.append(weight if weight > 0 else DEFAULT_WEIGHTS.get(value_type, 1.5))

    body = [[format_value(row.get(key), t) for key, t in zip(keys, types)] for row in rows]
    total_cells = None
    if totals is not None:
        total_cells = [format_value(totals.get(key), t) for key, t in zip(keys, types)]
        if not total_cells[0]:
            total_cells[0] = 'Total'

    # content widths at 1pt (string widths scale linearly with the font size)
    unit_widths = []
    for i in range(len(columns)):
        label_word = max((_text_width(word, 1, bold=True) for word in labels[i].split()), default=0)
        column_texts = [row[i] for row in body]
        if wrapping[i]:
            content = _longest_word_width(column_texts + ([total_cells[i]] if total_cells else []))
        else:
            content = max((stringWidth(text, FONT, 1) for text in column_texts if text), default=0)
            if total_cells and total_cells[i]:
                content = max(content, stringWidth(total_cells[i], FONT_BOLD, 1))
        unit_widths.append(max(content, label_word))

    widths = None
    for size in (8, 7.5, 7, 6.5, 6):
        pad = 4 if size >= 7.5 else 3
        needs = [unit * size + 2 * pad + 1 for unit in unit_widths]
        needs = [min(need, R.width * 0.25) if wrapping[i] else need for i, need in enumerate(needs)]
        widths = _fit_column_widths(R.width, weights, needs)
        if widths is not None:
            break
    if widths is None:  # still too wide at 6pt: squeeze proportionally
        widths = [need * R.width / sum(needs) for need in needs]

    leading = round(size * 1.3, 2)

    def cell(text, i, bold=False):
        """Plain string when it fits on one line; Paragraph for wrapping or Gujarati text.

        Latin-only paragraphs skip HarfBuzz (identical glyphs, much faster on big reports).
        """
        if not text:
            return ''
        gujarati = _GUJ_ANY_RE.search(text) is not None
        if not (gujarati or '\n' in text
                or (wrapping[i] and stringWidth(text, FONT_BOLD if bold else FONT, size) > widths[i] - 2 * pad)):
            return text
        style = _ps(size, bold=bold, align=TA_RIGHT if numeric[i] else TA_LEFT, leading=leading, shaping=gujarati)
        return Para(rich(text, bold=bold), style)

    head_size = size
    head_styles = [_ps(head_size, bold=True, color=WHITE, align=TA_RIGHT if numeric[i] else TA_LEFT,
                       leading=round(head_size * 1.25, 2)) for i in range(len(columns))]
    data = [[_p(labels[i], head_styles[i]) for i in range(len(columns))]]
    data += [[cell(text, i) for i, text in enumerate(row)] for row in body]

    commands = [
        ('FONT', (0, 0), (-1, -1), FONT, size, leading),
        ('TEXTCOLOR', (0, 0), (-1, -1), TEXT),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('VALIGN', (0, 0), (-1, 0), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), pad), ('RIGHTPADDING', (0, 0), (-1, -1), pad),
        ('TOPPADDING', (0, 0), (-1, -1), 3.2), ('BOTTOMPADDING', (0, 0), (-1, -1), 3.2),
        ('TOPPADDING', (0, 0), (-1, 0), 5), ('BOTTOMPADDING', (0, 0), (-1, 0), 5),
        ('BACKGROUND', (0, 0), (-1, 0), BRAND),
    ]
    for i in range(len(columns)):
        if numeric[i]:
            commands.append(('ALIGN', (i, 1), (i, -1), 'RIGHT'))
    if body:
        commands += [('ROWBACKGROUNDS', (0, 1), (-1, len(body)), [WHITE, SLATE_50]),
                     ('LINEBELOW', (0, 1), (-1, len(body)), 0.4, BORDER)]
    else:
        data.append([NO_RECORDS] + [''] * (len(columns) - 1))
        commands += [('SPAN', (0, 1), (-1, 1)), ('ALIGN', (0, 1), (-1, 1), 'CENTER'),
                     ('TEXTCOLOR', (0, 1), (-1, 1), MUTED), ('FONT', (0, 1), (-1, 1), FONT, 9, 12),
                     ('TOPPADDING', (0, 1), (-1, 1), 16), ('BOTTOMPADDING', (0, 1), (-1, 1), 16),
                     ('LINEBELOW', (0, 1), (-1, 1), 0.4, BORDER)]
    if total_cells is not None:
        last = len(data)
        data.append([cell(text, i, bold=True) for i, text in enumerate(total_cells)])
        commands += [('NOSPLIT', (0, max(1, last - 2)), (-1, last)),  # never orphan the totals row
                     ('FONT', (0, last), (-1, last), FONT_BOLD, size, leading),
                     ('BACKGROUND', (0, last), (-1, last), BRAND_LIGHT),
                     ('LINEABOVE', (0, last), (-1, last), 1, BRAND),
                     ('LINEBELOW', (0, last), (-1, last), 1, BRAND),
                     ('TOPPADDING', (0, last), (-1, last), 4.5), ('BOTTOMPADDING', (0, last), (-1, last), 4.5)]
    table = DataTable(data, colWidths=widths, repeatRows=1, hAlign='LEFT', splitInRow=40)
    table.setStyle(TableStyle(commands))
    return [table]


def _report_notes(report, R):
    notes = [_s(note) for note in (report.get('notes') or []) if _s(note)]
    if not notes:
        return []
    style = _ps(9, leading=13)
    table = Table([[[_p(note, style) for note in notes]]], colWidths=[R.width], hAlign='LEFT', splitInRow=30)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), BRAND_LIGHT),
        ('LINEBEFORE', (0, 0), (0, 0), 2.5, BRAND),
        ('LEFTPADDING', (0, 0), (-1, -1), 10), ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
    ]))
    return [Spacer(1, 12), table]


def render_report_pdf(report: dict) -> bytes:
    """Generic table report / party or bank statement as PDF bytes."""
    report = report if isinstance(report, dict) else {}
    register_fonts()
    R = _ReportLayout(_s(report.get('orientation')).lower())
    title = _s(report.get('title')) or 'Report'
    business_name = _s((report.get('business') or {}).get('name'))
    footer_markup = rich(title) + (f'&nbsp;&nbsp;{chr(0xB7)}&nbsp;&nbsp;{rich(business_name)}' if business_name else '')
    info = {'title': title, 'author': business_name, 'subject': _s(report.get('subtitle'))}
    with _render_lock:
        story = (_report_header(report, R) + _report_info(report, R) + _report_summary(report, R)
                 + _report_table(report, R) + _report_notes(report, R))
        return _build(story, R.pagesize, R.margins, footer=_page_footer(7, R.mx, R.mb, footer_markup), info=info)
