import csv
import io
import json
import re
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser
from urllib.parse import urljoin
from xml.etree import ElementTree

from . import xpath as xp

MAX_BYTES = 10 * 1024 * 1024
TIMEOUT = 15
TTL = 300
_cache: dict[str, tuple[float, bytes, str]] = {}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}


class FetchError(Exception):
    pass


def fetch(url: str, fresh: bool = False, headers: dict | None = None) -> tuple[bytes, str]:
    if not url.lower().startswith(("http://", "https://")):
        raise FetchError("only http and https addresses are fetched")
    hit = _cache.get(url)
    if hit and not fresh and time.time() - hit[0] < TTL:
        return hit[1], hit[2]
    req = urllib.request.Request(url, headers={"User-Agent": "FormCel/0.34", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            body = r.read(MAX_BYTES + 1)
            ctype = r.headers.get("Content-Type", "")
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise FetchError(str(e))
    if len(body) > MAX_BYTES:
        raise FetchError("the response is over 10 MB")
    _cache[url] = (time.time(), body, ctype)
    return body, ctype


def forget(url: str | None = None) -> None:
    if url is None:
        _cache.clear()
    else:
        _cache.pop(url, None)


def decode(body: bytes, ctype: str = "") -> str:
    m = re.search(r"charset=([\w-]+)", ctype, re.I) or re.search(rb"charset=[\"']?([\w-]+)", body[:2048], re.I)
    enc = (m.group(1).decode() if m and isinstance(m.group(1), bytes) else m.group(1)) if m else "utf-8"
    try:
        return body.decode(enc, errors="replace")
    except LookupError:
        return body.decode("utf-8", errors="replace")


class Node:
    def __init__(self, tag: str, attrs: dict | None = None, parent: "Node | None" = None):
        self.tag = tag
        self.attrs = attrs or {}
        self.parent = parent
        self.kids: list[Node] = []
        self.chunks: list[tuple[int, str]] = []

    def text(self) -> str:
        out: list[str] = []

        def walk(n: "Node") -> None:
            order = sorted([(i, 0, t) for i, t in n.chunks] + [(idx, 1, k) for idx, k in enumerate(n.kids)], key=lambda x: (x[0], x[1]))
            for _, kind, v in order:
                if kind == 0:
                    out.append(v)
                else:
                    walk(v)

        walk(self)
        return "".join(out)

    def walk(self):
        for k in self.kids:
            yield k
            yield from k.walk()


class Builder(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = Node("#root")
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        n = Node(tag, {k: (v or "") for k, v in attrs}, self.cur)
        self.cur.kids.append(n)
        if tag not in VOID:
            self.cur = n

    def handle_startendtag(self, tag, attrs):
        self.cur.kids.append(Node(tag, {k: (v or "") for k, v in attrs}, self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not self.root and n.tag != tag:
            n = n.parent
        if n is not self.root:
            self.cur = n.parent

    def handle_data(self, data):
        if self.cur.tag in ("script", "style"):
            return
        self.cur.chunks.append((len(self.cur.kids), data))


def parse_html(text: str) -> Node:
    b = Builder()
    b.feed(text)
    b.close()
    return b.root


def from_xml(text: str) -> Node:
    try:
        el = ElementTree.fromstring(text.strip())
    except ElementTree.ParseError as e:
        raise FetchError(f"not valid XML: {e}")

    def conv(e, parent) -> Node:
        tag = e.tag.split("}")[-1]
        n = Node(tag, {k.split("}")[-1]: v for k, v in e.attrib.items()}, parent)
        if e.text:
            n.chunks.append((0, e.text))
        for i, c in enumerate(e):
            n.kids.append(conv(c, n))
            if c.tail:
                n.chunks.append((i + 1, c.tail))
        return n

    root = Node("#root")
    root.kids.append(conv(el, root))
    return root


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def tables_of(root: Node) -> list[list[list[str]]]:
    out = []
    for t in root.walk():
        if t.tag != "table":
            continue
        rows = []
        for tr in t.walk():
            if tr.tag != "tr":
                continue
            p, owner = tr.parent, None
            while p is not None:
                if p.tag == "table":
                    owner = p
                    break
                p = p.parent
            if owner is not t:
                continue
            cells = [clean(td.text()) for td in tr.kids if td.tag in ("td", "th")]
            if cells:
                rows.append(cells)
        if rows:
            w = max(len(r) for r in rows)
            out.append([r + [""] * (w - len(r)) for r in rows])
    return out


def lists_of(root: Node) -> list[list[list[str]]]:
    out = []
    for t in root.walk():
        if t.tag in ("ul", "ol"):
            items = [[clean(own_text(li))] for li in t.kids if li.tag == "li"]
            if items:
                out.append(items)
    return out


def own_text(n: Node) -> str:
    parts: list[str] = []
    order = sorted([(i, 0, t) for i, t in n.chunks] + [(i, 1, k) for i, k in enumerate(n.kids)], key=lambda x: (x[0], x[1]))
    for _, kind, v in order:
        if kind == 0:
            parts.append(v)
        elif v.tag not in ("ul", "ol"):
            parts.append(v.text())
    return "".join(parts)


FEED_KEYS = ("title", "author", "url", "created", "summary")


def _local(tag: str) -> str:
    return tag.split("}")[-1]


def _kid(e, *names: str):
    for c in e:
        if _local(c.tag) in names:
            return c
    return None


def _kid_text(e, *names: str) -> str:
    c = _kid(e, *names)
    return clean("".join(c.itertext())) if c is not None else ""


def parse_feed(text: str) -> tuple[dict, list[dict]]:
    try:
        root = ElementTree.fromstring(text.strip())
    except ElementTree.ParseError as e:
        raise FetchError(f"not a valid feed: {e}")
    kind = _local(root.tag)
    if kind == "rss" or kind == "RDF":
        chan = _kid(root, "channel") if kind == "rss" else root
        if chan is None:
            raise FetchError("the feed has no channel")
        head = {"title": _kid_text(chan, "title"), "author": _kid_text(chan, "managingEditor", "creator", "author"), "description": _kid_text(chan, "description"), "url": _kid_text(chan, "link")}
        rows = [e for e in (chan if kind == "rss" else root) if _local(e.tag) == "item"]
        items = [
            {
                "title": _kid_text(e, "title"),
                "author": _kid_text(e, "author", "creator"),
                "url": _kid_text(e, "link"),
                "created": _kid_text(e, "pubDate", "date"),
                "summary": _kid_text(e, "description", "encoded"),
            }
            for e in rows
        ]
        return head, items
    if kind == "feed":
        def link(e) -> str:
            best = ""
            for c in e:
                if _local(c.tag) == "link":
                    if c.get("rel", "alternate") == "alternate":
                        return c.get("href", "")
                    best = best or c.get("href", "")
            return best

        head = {"title": _kid_text(root, "title"), "author": _kid_text(_kid(root, "author"), "name") if _kid(root, "author") is not None else "", "description": _kid_text(root, "subtitle"), "url": link(root)}
        items = []
        for e in root:
            if _local(e.tag) != "entry":
                continue
            who = _kid(e, "author")
            items.append(
                {
                    "title": _kid_text(e, "title"),
                    "author": _kid_text(who, "name") if who is not None else "",
                    "url": link(e),
                    "created": _kid_text(e, "published", "updated"),
                    "summary": _kid_text(e, "summary", "content"),
                }
            )
        return head, items
    raise FetchError("the address is not an RSS or Atom feed")


def import_feed(url: str, query: str, headers: bool, count: int | None, fresh: bool = False) -> list[list[str]]:
    body, ctype = fetch(url, fresh)
    head, items = parse_feed(decode(body, ctype))
    words = (query or "items").lower().split()
    scope = words[0]
    field = words[1] if len(words) > 1 else None
    if scope == "feed":
        if field is None:
            cols = ["title", "author", "description", "url"]
            return ([[c for c in cols]] if headers else []) + [[head[c] for c in cols]]
        if field not in head:
            raise FetchError("the feed query is feed, feed title, feed author, feed description or feed url")
        return ([[field]] if headers else []) + [[head[field]]]
    if scope != "items":
        raise FetchError("the query is feed or items, with an optional field")
    if count is not None:
        items = items[:count]
    if field is not None and field not in FEED_KEYS:
        raise FetchError("the item field is title, author, url, created or summary")
    cols = [field] if field else list(FEED_KEYS)
    return ([cols] if headers else []) + [[it[c] for c in cols] for it in items]


def xpath(root: Node, query: str) -> list[str]:
    q = query.strip()
    if not q:
        raise FetchError("the XPath query is empty")
    call = re.match(r"([A-Za-z_][\w.\-]*)\s*\(", q)
    if not q.startswith(("/", "(", ".")) and not (call and call.group(1) not in ("text", "node")) and not re.match(r"[a-z\-]+::", q):
        q = "//" + q
    try:
        found = xp.evaluate(root, q)
    except xp.XPathError as e:
        raise FetchError(str(e))
    if isinstance(found, list):
        out = []
        for n in found:
            s = clean(xp.string_of(n))
            if s != "" or not isinstance(n, xp.Text):
                out.append(s)
        return out
    return [xp.string(found)]


def import_xml(url: str, query: str, fresh: bool = False) -> list[list[str]]:
    body, ctype = fetch(url, fresh)
    text = decode(body, ctype)
    try:
        root = from_xml(text) if text.lstrip().startswith("<?xml") or "xml" in ctype and "html" not in ctype else parse_html(text)
    except FetchError:
        root = parse_html(text)
    return [[v] for v in xpath(root, query)]


def filter_xml(xml: str, query: str) -> list[list[str]]:
    return [[v] for v in xpath(from_xml(xml), query)]


def import_html(url: str, kind: str, index: int, fresh: bool = False) -> list[list[str]]:
    body, ctype = fetch(url, fresh)
    root = parse_html(decode(body, ctype))
    found = tables_of(root) if kind.lower() == "table" else lists_of(root) if kind.lower() == "list" else None
    if found is None:
        raise FetchError("the query is table or list")
    if not 1 <= index <= len(found):
        raise FetchError(f"the page has {len(found)} {kind.lower()}s")
    return found[index - 1]


def html_tables(url: str, fresh: bool = False) -> list[list[list[str]]]:
    body, ctype = fetch(url, fresh)
    return tables_of(parse_html(decode(body, ctype)))


def split_csv(text: str, delimiter: str | None = None) -> list[list[str]]:
    text = text.lstrip("﻿")
    if not delimiter:
        try:
            delimiter = csv.Sniffer().sniff(text[:4096], ",;\t|").delimiter
        except csv.Error:
            delimiter = ","
    return [r for r in csv.reader(io.StringIO(text), delimiter=delimiter)]


def import_data(url: str, delimiter: str | None, fresh: bool = False) -> list[list[str]]:
    body, ctype = fetch(url, fresh)
    return split_csv(decode(body, ctype), delimiter)


def is_records(data) -> bool:
    if isinstance(data, dict):
        return True
    return bool(data) and all(isinstance(x, dict) for x in data)


def json_rows(data) -> list[list]:
    if isinstance(data, dict):
        for v in data.values():
            if isinstance(v, list) and v and all(isinstance(x, dict) for x in v):
                data = v
                break
        else:
            data = [data]
    if not isinstance(data, list):
        return [[data]]
    if data and all(isinstance(x, dict) for x in data):
        cols: list[str] = []
        for r in data:
            for k in r:
                if k not in cols:
                    cols.append(k)
        return [cols] + [[r.get(c, "") if not isinstance(r.get(c), (dict, list)) else json.dumps(r.get(c)) for c in cols] for r in data]
    return [[x] if not isinstance(x, list) else x for x in data]


def absolute(base: str, href: str) -> str:
    return urljoin(base, href)
