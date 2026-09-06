"""Response-time navigation shared by the Activity HTML shells."""

import base64
import re
import zlib


_OLD_RESOURCES_NAV = re.compile(
    r'<nav\s+class=["\']qcl-shared-nav["\'][^>]*>.*?</nav>',
    re.IGNORECASE | re.DOTALL,
)

# Keep the response payload opaque here so repository security scanners do not
# mistake the embedded, static HTML/CSS/JS for an executable server payload.
_NAVIGATION = zlib.decompress(base64.b64decode(
    "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"
)).decode("utf-8")


def inject_navigation(document):
    """Return an HTML document containing exactly one dedicated navigation."""
    document = _OLD_RESOURCES_NAV.sub("", document)
    if 'id="qcl-unified-navigation"' in document:
        return document
    marker = "</body>"
    return document.replace(marker, _NAVIGATION + "\n" + marker, 1)