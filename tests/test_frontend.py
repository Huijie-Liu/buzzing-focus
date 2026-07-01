"""E2E frontend tests for What's Buzzing — Playwright (Python).

These tests start the Flask dev server in a background thread and use
Playwright's route interception to mock API responses so external HTTP
calls are never made.

Run with::

    python -m pytest tests/test_frontend.py -v

Or with unittest::

    python -m unittest tests/test_frontend.py -v
"""

import json
import os
import sys
import threading
import time
import unittest

# Ensure the project root is on sys.path so server.py can be imported.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Prevent the Flask app from importing real API keys during tests.
os.environ.setdefault("DEEPSEEK_API_KEY", "")
os.environ.setdefault("DEEPSEEK_BASE_URL", "")

import server  # noqa: E402  — Flask app factory

# ---------------------------------------------------------------------------
# Mock feed data (one source worth of cards)
# ---------------------------------------------------------------------------

MOCK_SOURCE_EVENT = {
    "type": "source",
    "key": "hn",
    "label": "Hacker News",
    "short": "HN",
    "accent": "#f0652f",
    "count": 3,
    "items": [
        {
            "id": "hn-1",
            "title": "Show HN: A New JavaScript Framework",
            "summary": "",
            "url": "https://example.com/hn1",
            "discussionUrl": "https://news.ycombinator.com/item?id=1",
            "publishedAt": "2026-07-01T10:00:00Z",
            "source": "hn",
            "score": 42,
            "comments": 15,
        },
        {
            "id": "hn-2",
            "title": "The Future of WebAssembly",
            "summary": "",
            "url": "https://example.com/hn2",
            "discussionUrl": "https://news.ycombinator.com/item?id=2",
            "publishedAt": "2026-07-01T09:00:00Z",
            "source": "hn",
            "score": 128,
            "comments": 67,
        },
        {
            "id": "hn-3",
            "title": "Rust in the Linux Kernel",
            "summary": "",
            "url": "https://example.com/hn3",
            "discussionUrl": "https://news.ycombinator.com/item?id=3",
            "publishedAt": "2026-07-01T08:00:00Z",
            "source": "hn",
            "score": 256,
            "comments": 89,
        },
    ],
}

MOCK_DONE_EVENT = {
    "type": "done",
    "updatedAt": "2026-07-01T10:30:00Z",
    "errors": [],
}

MOCK_TRANSLATE_EVENT = {
    "type": "translate",
    "itemId": "hn-1",
    "field": "title",
    "translated": "展示 HN：一个新的 JavaScript 框架",
}


def _make_ndjson(*events):
    """Serialize events as NDJSON (one JSON object per line)."""
    return "\n".join(json.dumps(e, ensure_ascii=False) for e in events) + "\n"


def _mock_api_routes(page):
    """Intercept API calls so no real HTTP requests leave the test."""

    def handle_feed(route):
        body = _make_ndjson(MOCK_SOURCE_EVENT, MOCK_DONE_EVENT)
        route.fulfill(
            status=200,
            content_type="application/x-ndjson; charset=utf-8",
            body=body,
        )

    def handle_translate(route):
        body = _make_ndjson(MOCK_TRANSLATE_EVENT)
        route.fulfill(
            status=200,
            content_type="application/x-ndjson; charset=utf-8",
            body=body,
        )

    def handle_summary(route):
        body = _make_ndjson(
            {"type": "chunk", "text": "## 今日科技要闻\n\n- 新技术发布 [1]\n"},
            {"type": "done", "text": "## 今日科技要闻\n\n- 新技术发布 [1]\n", "sources": {}},
        )
        route.fulfill(
            status=200,
            content_type="application/x-ndjson; charset=utf-8",
            body=body,
        )

    def handle_preview(route):
        route.fulfill(status=200, json={"text": "Mock preview"})

    def handle_preview_image(route):
        route.fulfill(status=200, json={"image": None})

    page.route("**/api/feed**", handle_feed)
    page.route("**/api/translate**", handle_translate)
    page.route("**/api/summary**", handle_summary)
    page.route("**/api/preview**", handle_preview)
    page.route("**/api/preview-image**", handle_preview_image)


# ---------------------------------------------------------------------------
# Test server management
# ---------------------------------------------------------------------------

_server_thread = None
_server_port = 18765  # non-standard port to avoid clashes


def _start_server():
    """Start the Flask app in a background thread."""
    global _server_thread
    server.app.config["TESTING"] = True
    _server_thread = threading.Thread(
        target=server.app.run,
        kwargs={"host": "127.0.0.1", "port": _server_port, "debug": False, "use_reloader": False},
        daemon=True,
    )
    _server_thread.start()
    # Give the server a moment to bind.
    time.sleep(1.5)


# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------

class FrontendTests(unittest.TestCase):
    """Playwright E2E tests for the What's Buzzing frontend."""

    @classmethod
    def setUpClass(cls):
        """Start the test server once for all tests."""
        _start_server()

    def setUp(self):
        """Create a new browser context for each test."""
        # Import here so the module is importable even without playwright.
        from playwright.sync_api import sync_playwright

        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=True)
        self._context = self._browser.new_context()
        self._page = self._context.new_page()

    def tearDown(self):
        self._context.close()
        self._browser.close()
        self._pw.stop()

    # -- helpers -----------------------------------------------------------

    def _go(self):
        """Navigate to the app and mock API routes."""
        _mock_api_routes(self._page)
        self._page.goto(f"http://127.0.0.1:{_server_port}/", wait_until="networkidle")
        # Wait for feed skeleton to appear and then be replaced.
        self._page.wait_for_selector(".story", timeout=10000)

    # -- tests -------------------------------------------------------------

    def test_page_title(self):
        """Page title includes the app name."""
        self._go()
        title = self._page.title()
        self.assertIn("What's Buzzing", title)

    def test_category_tabs_rendered(self):
        """All 5 category tabs are present."""
        self._go()
        tabs = self._page.locator(".category-tab")
        self.assertGreaterEqual(tabs.count(), 5)

    def test_feed_columns_after_loading(self):
        """Cards appear after the mocked feed loads."""
        self._go()
        cards = self._page.locator(".story")
        self.assertGreaterEqual(cards.count(), 1)

    def test_category_switch(self):
        """Clicking a different tab changes active state."""
        self._go()
        # 综合 tab should not be active initially (热点 is)
        general_tab = self._page.locator(".category-tab").nth(1)
        self.assertFalse("active" in (general_tab.get_attribute("class") or ""))
        general_tab.click()
        self._page.wait_for_timeout(300)
        self.assertTrue("active" in (general_tab.get_attribute("class") or ""))

    def test_keyboard_navigation_j_k(self):
        """j/k keys move selection between cards."""
        self._go()
        # Wait a bit for layout to settle
        self._page.wait_for_timeout(500)
        # Verify column bounding rects are reasonable
        col_info = self._page.evaluate("""() => {
            const cols = [...document.querySelectorAll('.column')];
            return cols.map(c => ({
                source: c.dataset.source,
                rect: c.getBoundingClientRect()
            }));
        }""")
        # Dispatch j keydown via Playwright (should trigger handleVimKey)
        self._page.keyboard.press("j")
        self._page.wait_for_timeout(500)
        selected = self._page.locator(".story.selected")
        self.assertEqual(selected.count(), 1, f"j key failed. Columns: {col_info}")

    def test_keyboard_number_keys_switch_groups(self):
        """Pressing 2 switches to the 综合 group."""
        self._go()
        self._page.keyboard.press("2")
        self._page.wait_for_timeout(300)
        active_tab = self._page.locator(".category-tab.active")
        self.assertIn("综合", active_tab.text_content() or "")

    def test_theme_toggle(self):
        """Pressing t toggles dark mode."""
        self._go()
        body = self._page.locator("body")
        self.assertFalse("theme-dark" in (body.get_attribute("class") or ""))
        self._page.keyboard.press("t")
        self._page.wait_for_timeout(200)
        self.assertTrue("theme-dark" in (body.get_attribute("class") or ""))

    def test_help_modal(self):
        """Pressing ? shows the keyboard help overlay."""
        self._go()
        self._page.keyboard.press("?")
        self._page.wait_for_timeout(300)
        help_modal = self._page.locator(".kbd-help")
        self.assertTrue(help_modal.is_visible())

    def test_help_button_in_header(self):
        """The ? button in the header opens the help modal."""
        self._go()
        self._page.locator("#helpButton").click()
        self._page.wait_for_timeout(300)
        help_modal = self._page.locator(".kbd-help")
        self.assertTrue(help_modal.is_visible())

    def test_search_filter(self):
        """Search filters cards by title."""
        self._go()
        # Open search with / key
        self._page.keyboard.press("/")
        self._page.wait_for_timeout(200)
        # Type a query
        search_input = self._page.locator("#searchInput")
        search_input.fill("WebAssembly")
        self._page.wait_for_timeout(300)
        # Only matching cards should be visible
        visible_cards = self._page.locator(".story:not(.hidden-by-search)")
        count = visible_cards.count()
        # At least one card should match (the WebAssembly one)
        self.assertGreaterEqual(count, 1)
        # Check search count is shown
        search_count = self._page.locator("#searchCount")
        self.assertFalse(search_count.is_hidden())

    def test_last_updated_display(self):
        """After feed loads, the updated timestamp is visible."""
        self._go()
        updated_el = self._page.locator("#lastUpdated")
        self.assertFalse(updated_el.is_hidden())
        text = updated_el.text_content()
        self.assertIn("更新于", text)


if __name__ == "__main__":
    unittest.main()
