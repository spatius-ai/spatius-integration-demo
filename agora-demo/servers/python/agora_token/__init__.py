"""Agora AccessToken2 issuance, taken from the official AgoraIO/Tools repo.

AccessToken2.py, RtcTokenBuilder2.py and Packer.py from `python3/src/` are vendored
verbatim and unmodified — upgrading means replacing them wholesale.

Vendored rather than installed: the official implementation is published as source only,
with no corresponding package on PyPI. The `agora-token-builder` you can find there is
third-party and emits AccessToken1 (the `006` prefix) only, while ConvoAI's REST auth
requires AccessToken2 (the `007` prefix) and rejects the former. All three files depend
on nothing beyond the standard library.
"""

from .RtcTokenBuilder2 import RtcTokenBuilder, Role_Publisher

__all__ = ["RtcTokenBuilder", "Role_Publisher"]
