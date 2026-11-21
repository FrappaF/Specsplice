#!/usr/bin/env python3
"""Build the standalone HTML and printable PDF from the guide Markdown.

Dependencies: python3 -m pip install Markdown reportlab
Fonts: Liberation Sans and Liberation Mono (or pass --font-dir).
Run from any directory; only the generated files in --guide-dir are replaced.
Use --rebuild-examples to package the repository's guide fixtures before exporting.
Use --kit-only to assemble an offline kit from the existing exports and examples.
"""

import argparse
import base64
import hashlib
import html
import math
import mimetypes
import re
from pathlib import Path
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

import markdown
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfdoc import PDFString
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
	BaseDocTemplate, Frame, Image, KeepTogether, PageBreak, PageTemplate,
	Paragraph, Preformatted, Spacer, Table, TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[2]
INK = colors.HexColor('#1c2b36')
ACCENT = colors.HexColor('#12627c')
MUTED = colors.HexColor('#52636e')
LINE = colors.HexColor('#d9e1e4')


def slug(text):
	normalized = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode().lower()
	return re.sub(r'[^a-z0-9]+', '-', normalized).strip('-')


def plain(element):
	return ''.join(element.itertext())


def serialize(element):
	return ET.tostring(element, encoding='unicode', method='html')


def read_source(guide_dir):
	source = (guide_dir / 'README.md').read_text(encoding='utf-8')
	rendered = markdown.markdown(source, extensions=['tables', 'fenced_code', 'sane_lists'])
	root = ET.fromstring('<document>' + rendered + '</document>')
	seen = set()
	headings = []
	for element in root.iter():
		if element.tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
			anchor = slug(plain(element))
			if anchor in seen:
				suffix = 2
				while f'{anchor}-{suffix}' in seen:
					suffix += 1
				anchor = f'{anchor}-{suffix}'
			seen.add(anchor)
			element.set('id', anchor)
			headings.append(element)
	return root, headings


def build_html(guide_dir, root, headings, description, edition, revision):
	groups = []
	content = []
	part_open = False
	chapter_open = False
	for element in root:
		if element.tag == 'h2':
			if chapter_open:
				content.append('</section>')
				chapter_open = False
			if part_open:
				content.append('</div>')
			content.append('<div class="part">')
			part_open = True
			groups.append([element, []])
		elif element.tag == 'h3':
			if chapter_open:
				content.append('</section>')
			content.append('<section class="chapter">')
			chapter_open = True
			groups[-1][1].append(element)
		images = list(element.iter('img'))
		if images:
			for picture in images:
				path = guide_dir / picture.attrib['src']
				width, height = ImageReader(str(path)).getSize()
				picture.set('width', str(width))
				picture.set('height', str(height))
				picture.set('src', 'data:' + (mimetypes.guess_type(path.name)[0] or 'image/png')
					+ ';base64,' + base64.b64encode(path.read_bytes()).decode('ascii'))
				picture.set('loading', 'lazy')
				caption = html.escape(picture.get('alt', ''))
				content.append(f'<figure><button class="image-zoom" aria-label="Enlarge image: {caption}">'
					+ serialize(picture) + f'</button><figcaption>{caption}</figcaption></figure>')
		else:
			content.append(serialize(element))
	if chapter_open:
		content.append('</section>')
	if part_open:
		content.append('</div>')
	toc = []
	for heading, chapters in groups:
		links = [f'<li><a href="#{heading.get("id")}">Introduction</a></li>']
		links.extend(f'<li><a href="#{chapter.get("id")}">{html.escape(plain(chapter))}</a></li>'
			for chapter in chapters)
		toc.append('<details class="toc-group"><summary>' + html.escape(plain(heading))
			+ '</summary><ul>' + ''.join(links) + '</ul></details>')
	template = Path(__file__).with_name('user-guide-template.html').read_text(encoding='utf-8')
	values = {
		'TITLE': html.escape(plain(headings[0])),
		'DESCRIPTION': html.escape(description),
		'TOC': ''.join(toc),
		'CONTENT': '\n'.join(content),
		'FOOTER': html.escape(f'{edition} edition. Software revision · {revision}.'),
	}
	for key, value in values.items():
		template = template.replace(f'@@{key}@@', value)
	(guide_dir / 'Specsplice-User-Guide.html').write_text(template, encoding='utf-8')


def register_fonts(font_dir):
	for family, source in [('GuideSans', 'LiberationSans'), ('GuideMono', 'LiberationMono')]:
		for suffix, filename in [('', 'Regular'), ('-Bold', 'Bold'), ('-Italic', 'Italic'), ('-BoldItalic', 'BoldItalic')]:
			pdfmetrics.registerFont(TTFont(family + suffix, str(font_dir / f'{source}-{filename}.ttf')))
		pdfmetrics.registerFontFamily(family, normal=family, bold=family + '-Bold',
			italic=family + '-Italic', boldItalic=family + '-BoldItalic')


def inline(element):
	result = html.escape(element.text or '')
	for child in element:
		text = inline(child)
		if child.tag in ('strong', 'b'):
			result += '<b>' + text + '</b>'
		elif child.tag in ('em', 'i'):
			result += '<i>' + text + '</i>'
		elif child.tag == 'code':
			result += '<font name="GuideMono" size="8.8">' + text + '</font>'
		elif child.tag == 'a':
			result += '<a color="#12627c" href="' + html.escape(child.get('href', ''), quote=True) + '">' + text + '</a>'
		elif child.tag == 'br':
			result += '<br/>'
		else:
			result += text
		result += html.escape(child.tail or '')
	return result


class GuideDocument(BaseDocTemplate):
	def __init__(self, filename, edition, revision, title, description):
		super().__init__(str(filename), pagesize=A4, leftMargin=50, rightMargin=50,
			topMargin=48, bottomMargin=48, title=title, author='Specsplice', subject=description)
		self.edition = edition
		self.revision = revision
		frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height,
			leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
		self.addPageTemplates(PageTemplate(id='guide', frames=[frame], onPage=self.page_footer))

	def page_footer(self, canvas, doc):
		canvas._doc.Catalog.Lang = PDFString('en')
		canvas.setCreator('Specsplice · ordito/scripts/build-user-guide.py')
		if doc.page == 1:
			return
		canvas.saveState()
		canvas.setFont('GuideSans', 8)
		canvas.setFillColor(MUTED)
		canvas.drawString(50, 27, f'Specsplice · User Guide · {self.edition}')
		canvas.drawRightString(A4[0] - 50, 27, str(doc.page))
		canvas.restoreState()

	def afterFlowable(self, flowable):
		if not hasattr(flowable, 'guide_heading'):
			return
		level, title, anchor = flowable.guide_heading
		self.canv.bookmarkPage(anchor)
		if level in (2, 3):
			self.canv.addOutlineEntry(title, anchor, level=level - 2, closed=False)
			self.notify('TOCEntry', (level - 2, title, self.page, anchor))


def build_pdf(guide_dir, root, headings, description, edition, revision, font_dir):
	register_fonts(font_dir)
	styles = getSampleStyleSheet()
	styles.add(ParagraphStyle(name='GuideBody', fontName='GuideSans', fontSize=10.1,
		leading=14, textColor=INK, spaceAfter=9, allowWidows=0, allowOrphans=0))
	for name, size, leading, before, after in [
		('GuideH1', 30, 36, 0, 22), ('GuideH2', 24, 29, 0, 16),
		('GuideH3', 17, 21, 16, 10), ('GuideH4', 11.8, 15, 10, 7),
	]:
		styles.add(ParagraphStyle(name=name, fontName='GuideSans-Bold', fontSize=size,
			leading=leading, textColor=ACCENT, spaceBefore=before, spaceAfter=after, keepWithNext=True))
	styles.add(ParagraphStyle(name='GuideCell', parent=styles['GuideBody'], fontSize=8.2,
		leading=11, spaceAfter=0))
	styles.add(ParagraphStyle(name='GuideCaption', parent=styles['GuideBody'], fontSize=8,
		leading=11, textColor=MUTED, spaceAfter=12))
	styles.add(ParagraphStyle(name='GuideList', parent=styles['GuideBody'], leftIndent=16,
		bulletIndent=0, bulletFontName='GuideSans', bulletFontSize=10.1))
	styles.add(ParagraphStyle(name='GuideCode', fontName='GuideMono', fontSize=8.8,
		leading=12, textColor=INK, leftIndent=10, spaceBefore=6, spaceAfter=12))
	styles.add(ParagraphStyle(name='GuideQuote', parent=styles['GuideBody'], leftIndent=16,
		borderPadding=8, backColor=colors.HexColor('#f1f6f8')))
	doc = GuideDocument(guide_dir / 'Specsplice-User-Guide.pdf', edition, revision,
		plain(headings[0]), description)
	story = [Spacer(1, 75), Paragraph('Specsplice', styles['GuideH1']),
		Paragraph('User Guide', styles['GuideH1']),
		Paragraph('Order Shop tour<br/>Build Marketplace from scratch<br/>Atlas of 16 diagrams', styles['GuideH3']),
		Spacer(1, 28), Paragraph(f'{html.escape(edition)} edition', styles['GuideBody']),
		Paragraph(f'Software revision · {html.escape(revision)}.', styles['GuideBody']),
		Paragraph('Model a system, define contracts, simulate behavior, and review changes.',
			styles['GuideBody']), PageBreak(),
		Paragraph('Contents', styles['GuideH2'])]
	toc = TableOfContents()
	toc.levelStyles = [
		ParagraphStyle(name='GuideTOC0', fontName='GuideSans-Bold', fontSize=10,
			leading=13, spaceBefore=9, spaceAfter=5, textColor=ACCENT),
		ParagraphStyle(name='GuideTOC1', fontName='GuideSans', fontSize=9.1,
			leading=12, leftIndent=12, firstLineIndent=0, spaceAfter=3, textColor=INK),
	]
	story.extend([toc, PageBreak()])

	def paragraph(element, style='GuideBody', **options):
		return Paragraph(inline(element), styles[style], **options)

	def table(element):
		rows = list(element.iter('tr'))
		cells = [list(row) for row in rows]
		count = len(cells[0])
		weights = [math.sqrt(sum(min(len(plain(row[i])), 160) for row in cells) / len(cells) + 20)
			for i in range(count)]
		widths = [doc.width * weight / sum(weights) for weight in weights]
		data = []
		for row_index, row in enumerate(cells):
			data.append([Paragraph(('<b>' + inline(cell) + '</b>') if row_index == 0 else inline(cell),
				styles['GuideCell']) for cell in row])
		result = Table(data, colWidths=widths, repeatRows=1, hAlign='LEFT', spaceBefore=7, spaceAfter=12)
		result.setStyle(TableStyle([
			('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e9f1f4')),
			('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f8fafb')]),
			('LINEBELOW', (0, 0), (-1, 0), .4, LINE), ('GRID', (0, 0), (-1, -1), .3, LINE),
			('LEFTPADDING', (0, 0), (-1, -1), 7), ('RIGHTPADDING', (0, 0), (-1, -1), 7),
			('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
		]))
		return result

	def add(element):
		if element.tag in ('h1',):
			return
		if element.tag in ('h2', 'h3', 'h4', 'h5', 'h6'):
			level = int(element.tag[1])
			if level == 2 and any(getattr(item, 'guide_heading', (0,))[0] == 2 for item in story):
				story.append(PageBreak())
			heading = paragraph(element, f'GuideH{min(level, 4)}')
			heading.guide_heading = (level, plain(element), element.get('id'))
			story.append(heading)
		elif element.tag == 'table':
			story.append(table(element))
		elif element.tag in ('ol', 'ul'):
			for index, item in enumerate(element, int(element.get('start', '1'))):
				story.append(paragraph(item, 'GuideList', bulletText=f'{index}.' if element.tag == 'ol' else '•'))
		elif element.tag == 'pre':
			story.append(Preformatted(plain(element).rstrip(), styles['GuideCode']))
		elif element.tag == 'blockquote':
			for child in element:
				story.append(paragraph(child, 'GuideQuote'))
		elif element.tag == 'p':
			picture = element.find('img')
			if picture is None:
				story.append(paragraph(element))
			else:
				image = Image(str(guide_dir / picture.get('src')))
				scale = min(doc.width / image.imageWidth, 280 / image.imageHeight)
				image.drawWidth = image.imageWidth * scale
				image.drawHeight = image.imageHeight * scale
				image.hAlign = TA_LEFT
				story.append(KeepTogether([Spacer(1, 5), image, Spacer(1, 5),
					Paragraph(html.escape(picture.get('alt', '')), styles['GuideCaption'])]))
		elif element.tag == 'hr':
			story.append(Spacer(1, 8))
		else:
			raise ValueError(f'Unsupported Markdown block: {element.tag}')

	# The edition line is on the cover; preserve every other source block.
	for element in root:
		if element.tag == 'p' and plain(element).startswith('A tour, a project built from scratch, and a diagram reference.'):
			continue
		add(element)
	doc.multiBuild(story)


def write_archive(destination, source, files, prefix):
	with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
		for path in files:
			archive.write(path, prefix + path.relative_to(source).as_posix())
	with zipfile.ZipFile(destination) as archive:
		if archive.testzip() is not None:
			raise RuntimeError(f'Archive CRC check failed: {destination}')
		for path in files:
			if archive.read(prefix + path.relative_to(source).as_posix()) != path.read_bytes():
				raise RuntimeError(f'Archive differs from source: {path}')


def build_examples(guide_dir):
	source = ROOT / 'ordito/examples/user-guide'
	project_files = {'model.json', 'criteria.json', 'feature-code-cases.json'}
	files = []
	for path in sorted(source.rglob('*')):
		if not path.is_file() or path.is_symlink():
			continue
		parts = path.relative_to(source).parts
		hidden = [part for part in parts if part.startswith('.')]
		if 'node_modules' in parts:
			continue
		if not hidden or hidden == ['.gitignore'] or (
			hidden == ['.ordito'] and parts[-2] == '.ordito' and path.name in project_files
		):
			files.append(path)
	write_archive(guide_dir / 'example-projects.zip', source, files, 'Specsplice-Example-Projects/')
	print(f'Examples verified: {len(files)} files.')


def build_kit(guide_dir):
	files = [guide_dir / name for name in ['README.md', 'Specsplice-User-Guide.html', 'Specsplice-User-Guide.pdf', 'example-projects.zip']]
	files.extend(sorted((guide_dir / 'images').glob('*.png')))
	write_archive(guide_dir / 'Specsplice-User-Kit.zip', guide_dir, files, 'Specsplice-User-Guide/')
	print(f'Kit verified: {len(files)} files.')


def main():
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument('--guide-dir', type=Path, default=ROOT / 'ordito/docs/user-guide')
	parser.add_argument('--edition', default='20 November 2026')
	parser.add_argument('--revision', required=True, help='Version or revision of the software described in the guide.')
	parser.add_argument('--font-dir', type=Path, default=next((path for path in
		[Path('/usr/share/fonts/truetype/liberation2'), Path('/usr/share/fonts/truetype/liberation')]
		if path.is_dir()), Path('/usr/share/fonts/truetype/liberation2')))
	parser.add_argument('--kit-only', action='store_true', help='Assemble the user kit from the existing exports and example archive.')
	parser.add_argument('--rebuild-examples', action='store_true', help='Package the guide fixtures from ordito/examples/user-guide.')
	args = parser.parse_args()
	if args.rebuild_examples:
		build_examples(args.guide_dir)
	if not args.kit_only:
		root, headings = read_source(args.guide_dir)
		description = f'Specsplice User Guide. Software revision · {args.revision}. {args.edition} edition.'
		# HTML embeds images, so build PDF first while its input still has local image paths.
		build_pdf(args.guide_dir, root, headings, description, args.edition, args.revision, args.font_dir)
		build_html(args.guide_dir, root, headings, description, args.edition, args.revision)
		for name in ['Specsplice-User-Guide.html', 'Specsplice-User-Guide.pdf']:
			path = args.guide_dir / name
			print(f'{name}: {path.stat().st_size} bytes; SHA-256 {hashlib.sha256(path.read_bytes()).hexdigest()}')
	else:
		build_kit(args.guide_dir)


if __name__ == '__main__':
	main()
