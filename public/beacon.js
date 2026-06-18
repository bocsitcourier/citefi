/**
 * ApexContent Engine — Engagement Beacon
 * Embed on client sites to track content engagement.
 *
 * Usage (add to <head> or before </body>):
 *   <script
 *     src="https://YOUR_ENGINE_URL/beacon.js"
 *     data-team-id="42"
 *     data-content-type="article"
 *     data-content-id="1234"
 *     data-engine-url="https://YOUR_ENGINE_URL"
 *   ></script>
 */
(function () {
  "use strict";

  var script = document.currentScript ||
    document.querySelector('script[data-team-id]');
  if (!script) return;

  var teamId = parseInt(script.getAttribute("data-team-id") || "0", 10);
  var contentType = script.getAttribute("data-content-type") || "article";
  var contentId = parseInt(script.getAttribute("data-content-id") || "0", 10);
  var engineUrl = (script.getAttribute("data-engine-url") || "").replace(/\/$/, "");

  if (!teamId || !contentId || !engineUrl) return;

  // Generate or restore an anonymous session ID for this browsing session
  var sessionId;
  try {
    sessionId = sessionStorage.getItem("_apex_sid");
    if (!sessionId) {
      sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem("_apex_sid", sessionId);
    }
  } catch (e) {
    sessionId = Math.random().toString(36).slice(2);
  }

  function send(eventType, extra) {
    var payload = JSON.stringify({
      teamId: teamId,
      contentType: contentType,
      contentId: contentId,
      eventType: eventType,
      sessionId: sessionId,
      metadata: extra || undefined,
    });
    var url = engineUrl + "/api/events/beacon";

    // sendBeacon with text/plain avoids CORS preflight (safelisted content type)
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: "text/plain" }));
      return;
    }

    // XHR fallback — triggers preflight, handled by OPTIONS route on server
    var xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(payload);
  }

  // Fire a view event on load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { send("view"); });
  } else {
    send("view");
  }

  // Track outbound link clicks
  document.addEventListener("click", function (e) {
    var target = /** @type {Element|null} */ (e.target);
    while (target && target.tagName !== "A") {
      target = target.parentElement;
    }
    if (!target) return;
    var href = /** @type {HTMLAnchorElement} */ (target).href || "";
    if (href && !href.startsWith(location.origin)) {
      send("click", { href: href.slice(0, 200) });
    }
  }, { passive: true });
})();
