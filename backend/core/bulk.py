"""Shared pieces of the "tick several rows, delete them together" endpoints.

A bulk delete never gives up half way: every row is tried on its own, and the rows that cannot go
(a party that still has bills, a payment that belongs to a cash bill) come back with their reason.
"""

MAX_BULK_DELETE = 200


def error_text(error):
    """The single line a ValidationError carries, for telling the user why a row was kept."""
    detail = error.detail
    if isinstance(detail, dict):
        detail = detail.get('detail') or next(iter(detail.values()), '')
    if isinstance(detail, (list, tuple)):
        detail = detail[0] if detail else ''
    return str(detail)
