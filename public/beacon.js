/**
 * ApexContent Engine — Engagement Beacon v2
 * Spec: page_view, 15s heartbeat, scroll milestones (25/50/75/100%),
 *       cta_click, read_complete (75%+ scroll AND 60s+ engaged dwell),
 *       outbound clicks, bounce (<10% scroll AND <10s engaged at session end).
 *
 * Client-side session signals:
 *   isReturn     — visitor has engaged with any content from this team before
 *   sessionCount — total sessions this visitor has had (incremented per session)
 *
 * Note: fatigueSignal (5+ pieces from team in 7d without conversion) is a
 * cross-session server-side metric, computed nightly by the ConversionLabeler.
 * It is NOT computed client-side.
 *
 * First-party visitor ID (_apex_vid cookie, 365d).
 * Batches events; flushes on pagehide (session-end summary) and on
 * visibilitychange→hidden (interim flush in case page is killed while backgrounded).
 *
 * Usage (inject via beaconScriptUrl or add before </body>):
 *   <script
 *     src="https://YOUR_ENGINE_URL/api/events/beacon.js"
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

  var BEACON_URL = engineUrl + "/api/events/beacon";

  // ── Visitor ID (_apex_vid cookie, UUID, 365 days) ────────────────────────
  function getOrCreateVisitorId() {
    var match = document.cookie.match(/(?:^|;\s*)_apex_vid=([^;]+)/);
    if (match) return match[1];
    var vid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
    var exp = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = "_apex_vid=" + vid + "; expires=" + exp + "; path=/; SameSite=Lax";
    return vid;
  }

  // ── Session ID (_apex_sid, session-scoped) ────────────────────────────────
  function getSessionId() {
    try {
      var sid = sessionStorage.getItem("_apex_sid");
      if (!sid) {
        sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem("_apex_sid", sid);
      }
      return sid;
    } catch (e) {
      return Math.random().toString(36).slice(2);
    }
  }

  // ── isReturn: visitor has previously engaged with any content from this team ─
  // Spec: team-scoped (any content from this team), not content-scoped.
  // Uses a single team-level key so first visit to any team page sets it.
  function getIsReturn(vid) {
    try {
      var key = "_apex_seen_team_" + teamId;
      var seen = localStorage.getItem(key);
      if (seen) return true;
      localStorage.setItem(key, "1");
      return false;
    } catch (e) { return false; }
  }

  // ── sessionCount: total sessions for this visitor (cross-content counter) ─
  function getAndIncrementSessionCount(vid) {
    try {
      var key = "_apex_sc_" + vid;
      var current = parseInt(localStorage.getItem(key) || "0", 10);
      var newCount = current + 1;
      localStorage.setItem(key, String(newCount));
      return newCount;
    } catch (e) { return 1; }
  }

  // ── UTM extraction ────────────────────────────────────────────────────────
  function getUtm() {
    try {
      var p = new URLSearchParams(location.search);
      var u = {};
      if (p.get("utm_source")) u.utmSource = p.get("utm_source");
      if (p.get("utm_medium")) u.utmMedium = p.get("utm_medium");
      if (p.get("utm_campaign")) u.utmCampaign = p.get("utm_campaign");
      if (p.get("utm_content")) u.utmContent = p.get("utm_content");
      return u;
    } catch (e) { return {}; }
  }

  // ── Device detection ──────────────────────────────────────────────────────
  function getDevice() {
    var ua = navigator.userAgent;
    if (/Mobi|Android|iPhone|iPad/.test(ua)) {
      return /iPad/.test(ua) ? "tablet" : "mobile";
    }
    return "desktop";
  }

  // ── Shared context ────────────────────────────────────────────────────────
  var visitorId = getOrCreateVisitorId();
  var sessionId = getSessionId();
  var isReturn = getIsReturn(visitorId);
  var sessionCount = getAndIncrementSessionCount(visitorId);
  var utm = getUtm();
  var device = getDevice();
  var locale = (navigator.language || "").slice(0, 20) || undefined;

  // ── Event queue + flush ───────────────────────────────────────────────────
  var queue = [];

  function enqueue(eventType, extra) {
    var base = {
      teamId: teamId,
      contentType: contentType,
      contentId: contentId,
      eventType: eventType,
      sessionId: sessionId,
      visitorId: visitorId,
      device: device,
      isReturn: isReturn,
      sessionCount: sessionCount,
    };
    if (locale) base.locale = locale;
    // merge UTM
    var key;
    for (key in utm) { if (utm.hasOwnProperty(key)) base[key] = utm[key]; }
    // merge extra
    if (extra) { for (key in extra) { if (extra.hasOwnProperty(key)) base[key] = extra[key]; } }
    queue.push(base);
  }

  function flush() {
    if (queue.length === 0) return;
    var payload = JSON.stringify(queue.splice(0));
    if (navigator.sendBeacon) {
      navigator.sendBeacon(BEACON_URL, new Blob([payload], { type: "text/plain" }));
      return;
    }
    var xhr = new XMLHttpRequest();
    xhr.open("POST", BEACON_URL, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(payload);
  }

  function send(eventType, extra) {
    enqueue(eventType, extra);
    // Flush immediately for high-value events
    if (eventType === "conversion" || eventType === "cta_click" || eventType === "read_complete") {
      flush();
    }
  }

  // ── Page view on load ─────────────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { send("page_view"); });
  } else {
    send("page_view");
  }

  // ── Heartbeat every 15s (only when tab is visible) ────────────────────────
  var engagedSec = 0;
  var tabHidden = false;

  document.addEventListener("visibilitychange", function () {
    tabHidden = document.visibilityState === "hidden";
  });

  setInterval(function () {
    if (!tabHidden) {
      engagedSec += 15;
      enqueue("heartbeat", { engagedSec: engagedSec });
    }
  }, 15000);

  // ── Scroll milestones (25, 50, 75, 100%) ─────────────────────────────────
  // read_complete = 75%+ scroll AND 60s+ engaged dwell (spec corrected)
  // bounce        = unload with < 10% scroll AND < 10s engaged
  var milestones = [25, 50, 75, 100];
  var firedMilestones = {};
  var readCompleteFired = false;

  function getScrollPct() {
    var docH = Math.max(
      document.body.scrollHeight, document.documentElement.scrollHeight,
      document.body.offsetHeight, document.documentElement.offsetHeight
    );
    var viewH = window.innerHeight || document.documentElement.clientHeight || 768;
    if (docH <= viewH) return 100;
    var scrolled = window.pageYOffset || document.documentElement.scrollTop || 0;
    return Math.min(100, Math.round(((scrolled + viewH) / docH) * 100));
  }

  function onScroll() {
    var pct = getScrollPct();

    // Milestone events
    for (var i = 0; i < milestones.length; i++) {
      var m = milestones[i];
      if (!firedMilestones[m] && pct >= m) {
        firedMilestones[m] = true;
        send("scroll_milestone", { scrollPct: m });
      }
    }

    // read_complete: 75%+ scroll AND 60s+ engaged dwell
    if (!readCompleteFired && pct >= 75 && engagedSec >= 60) {
      readCompleteFired = true;
      send("read_complete", {
        scrollPct: pct,
        engagedSec: engagedSec,
        readComplete: true,
      });
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });

  // Also check read_complete on each heartbeat tick (handles slow readers
  // who don't scroll after reaching 75%)
  setInterval(function () {
    if (!readCompleteFired) onScroll();
  }, 5000);

  // ── CTA click tracking (data-apex-cta attribute) + outbound links ─────────
  document.addEventListener("click", function (e) {
    var target = e.target;
    while (target && target !== document) {
      if (target.hasAttribute && target.hasAttribute("data-apex-cta")) {
        send("cta_click", { metadata: { cta: target.getAttribute("data-apex-cta") } });
        break;
      }
      if (target.tagName === "A") {
        var href = (target.href || "");
        if (href && !href.startsWith(location.origin)) {
          send("click", { metadata: { href: href.slice(0, 200) } });
        }
        break;
      }
      target = target.parentElement;
    }
  }, { passive: true });

  // ── Session-end flush ────────────────────────────────────────────────────
  // Two separate strategies:
  //
  // 1. pagehide (true navigation away / tab close / BFCache entry):
  //    Emit a final page_view event with session summary (bounce flag, engaged time,
  //    max scroll) then flush. This is the authoritative session-end record.
  //
  // 2. visibilitychange → hidden (tab switch / backgrounded):
  //    Only flush any queued events so they survive if the browser kills the page
  //    while backgrounded. Do NOT mark the session as ended — the user may return.
  //
  // This separation avoids the data-loss bug where tab-switch prematurely finalizes
  // the session, preventing the real session-end event from ever being sent.

  var sessionFinalized = false;

  function onFinalUnload() {
    if (sessionFinalized) return;
    sessionFinalized = true;
    var pct = getScrollPct();
    // Bounce: left with <10% scroll AND <10s engaged (spec: shallow + quick exit)
    var bounced = pct < 10 && engagedSec < 10;
    // Final page_view event carries session-end signals (bounced, scroll depth, engaged time)
    enqueue("page_view", {
      bounced: bounced,
      engagedSec: engagedSec,
      scrollPct: pct,
    });
    flush();
  }

  window.addEventListener("pagehide", onFinalUnload);

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      // Interim flush: preserve queued events in case browser kills the page
      // while it is backgrounded. Do NOT finalize session.
      flush();
    }
  });
})();
