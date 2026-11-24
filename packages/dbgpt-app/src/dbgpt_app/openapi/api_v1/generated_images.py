"""Owner-scoped delivery for generated image URLs, including old chat history."""
import json
import logging
import re
from pathlib import Path
from urllib.parse import quote

IMAGE_NAME = re.compile(r"\w[\w .-]{0,240}\.(?:png|jpe?g|gif|webp|svg)", re.I)
logger = logging.getLogger(__name__)


def history_has_image(detail, url):
    """Only structured image outputs count, never a quoted URL in user prose."""
    try:
        row = json.loads(detail) if isinstance(detail, str) else detail
        if not isinstance(row, dict):
            return False
        if row.get("type") == "view":
            row = (row.get("data") or row).get("content")
            row = json.loads(row) if isinstance(row, str) else row
        if not isinstance(row, dict) or row.get("type") != "react-agent":
            return False
        if url in row.get("generated_images", []):
            return True
        return any(
            output.get("output_type") == "image" and output.get("content") == url
            for step in row.get("steps", []) if isinstance(step, dict)
            for output in step.get("outputs", []) if isinstance(output, dict)
        )
    except (ValueError, TypeError):
        return False


def owner_history_has_image(owner, name):
    from dbgpt.storage.metadata import BaseDao
    from dbgpt.storage.chat_history.chat_history_db import ChatHistoryEntity, ChatHistoryMessageEntity

    with BaseDao().session(commit=False) as session:
        rows = session.query(ChatHistoryMessageEntity.message_detail).join(
            ChatHistoryEntity, ChatHistoryEntity.conv_uid == ChatHistoryMessageEntity.conv_uid
        ).filter(
            ChatHistoryEntity.user_name == owner,
            ChatHistoryMessageEntity.message_detail.contains(name, autoescape=True),
        ).all()
        return any(history_has_image(row[0], "/images/" + name) for row in rows)


def register_images(root, urls, owner):
    """Index ownership before SSE images can reach the browser (history may lag)."""
    if not owner:
        return
    root = Path(root).resolve()
    for url in urls:
        if not isinstance(url, str) or not url.startswith("/images/"):
            continue
        name = url.removeprefix("/images/")
        if not IMAGE_NAME.fullmatch(name) or not (root / name).is_file():
            continue
        # Exclusive create: a later observation cannot transfer an image owner.
        try:
            directory = root / ".owners"
            directory.mkdir(exist_ok=True)
            marker = directory / (name + ".json")
            with marker.open("x", encoding="utf-8") as stream:
                json.dump({"owner": owner}, stream)
        except FileExistsError:
            pass
        except OSError:
            # Image indexing must not abort a successful analytical tool.
            # Persisted owner-scoped history remains the fallback authority.
            logger.warning("Image owner index unavailable; using persisted history fallback")


def resolve_image(root, name, owner, history_lookup=owner_history_has_image):
    if not owner or not IMAGE_NAME.fullmatch(name):
        raise FileNotFoundError("Image not found")
    root = Path(root).resolve()
    file = (root / name).resolve()
    if not file.is_relative_to(root) or not file.is_file():
        raise FileNotFoundError("Image not found")
    marker = root / ".owners" / (name + ".json")
    if marker.is_file():
        try:
            allowed = json.loads(marker.read_text(encoding="utf-8")).get("owner") == owner
        except (ValueError, OSError):
            allowed = history_lookup(owner, name)
    else:
        allowed = history_lookup(owner, name)
    if not allowed:
        raise FileNotFoundError("Image not found")
    return file


def link_published_images(content, urls):
    """Replace only unambiguous inline local paths with actual published images."""
    images = [u for u in urls if isinstance(u, str) and u.startswith("/images/")
              and IMAGE_NAME.fullmatch(u.removeprefix("/images/"))]

    def replace(match):
        from dbgpt.core.interface.report_capture import public_image_basename

        basename = public_image_basename(Path(match.group(1)).name)
        candidates = {u for u in images if u.endswith("_" + basename)}
        return f"![Biểu đồ]({quote(candidates.pop(), safe='/')})" if len(candidates) == 1 else match.group(0)

    result = []
    fenced = False
    for line in content.splitlines(keepends=True):
        if line.lstrip().startswith("```"):
            fenced = not fenced
        result.append(line if fenced else re.sub(
            r"`((?:plots|charts|exports)/[^`\n]+\.(?:png|jpe?g|gif|webp|svg))`", replace, line,
            flags=re.I,
        ))
    return "".join(result)
