import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("notification menu dismisses outside, on Escape, and after a view change", async () => {
  const page = await readFile("app/page.tsx", "utf8");

  assert.match(page, /notificationMenuRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(page, /document\.addEventListener\("pointerdown"/);
  assert.match(page, /!notificationMenuRef\.current\?\.contains\(target\)/);
  assert.match(page, /document\.addEventListener\("keydown"/);
  assert.match(page, /event\.key === "Escape"/);
  assert.match(
    page,
    /useEffect\(\(\) => \{\s*setNotificationsOpen\(false\);\s*\}, \[view\]\)/,
  );
  assert.match(
    page,
    /className="notification-menu" ref=\{notificationMenuRef\}/,
  );
});
