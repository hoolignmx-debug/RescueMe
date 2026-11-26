/* ============================================================================
   dashboard.js  -  EMS Response Dashboard (index.html)
   Shows summary numbers, emergency cards and the ambulance fleet, plus the
   AUTOMATION panel (status, AI recommendation, timeline, activity log and
   manual override) for the incident being monitored.
   Starts the automation heartbeat: Automation.tick() (automation.js).
   Uses ONLY functions from api.js / automation.js / rules.js.
   ============================================================================ */
(function () {
  "use strict";

  initPage();

  const REFRESH_MS = 5000;                      // refresh the dashboard every 5 seconds
  const SEVERITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };

  // Rules for the filter buttons
  const FILTERS = {
    ACTIVE: function (i) { return i.status !== "HOSPITAL_ARRIVED"; },
    HIGH: function (i) { return i.status !== "HOSPITAL_ARRIVED" && i.severity === "HIGH"; },
    AWAITING: function (i) { return !i.ambulance_id && i.status !== "HOSPITAL_ARRIVED"; },
    COMPLETED: function (i) { return i.status === "HOSPITAL_ARRIVED"; },
    ALL: function () { return true; }
  };

  const listEl = document.getElementById("incident-list");
  const fleetEl = document.getElementById("fleet-body");
  const refreshBtn = document.getElementById("refresh-btn");
  const resetBtn = document.getElementById("reset-btn");

  let incidents = [];
  let ambulances = [];
  let ambulancesLoaded = false;
  let activeFilter = "ACTIVE";
  let loading = false;

  const RETRY_HTML = "<button type=\"button\" class=\"btn btn-outline btn-sm\" data-action=\"retry\">Try again</button>";

  // ---- Loading -------------------------------------------------------------------
  async function loadDashboard(isFirstLoad) {
    if (loading) return;
    loading = true;
    try {
      const results = await Promise.allSettled([getIncidents(), getAmbulances()]);
      const incRes = results[0];
      const ambRes = results[1];

      if (incRes.status === "fulfilled") incidents = Array.isArray(incRes.value) ? incRes.value : [];
      if (ambRes.status === "fulfilled") {
        ambulances = Array.isArray(ambRes.value) ? ambRes.value : [];
        ambulancesLoaded = true;
      }

      const failure = incRes.status === "rejected" ? incRes.reason
                    : ambRes.status === "rejected" ? ambRes.reason : null;

      if (failure) {
        handleError(failure, { extraHtml: RETRY_HTML });
      } else {
        clearAlert();
      }

      if (incRes.status === "fulfilled") {
        pickFocus();
        renderAll();
        loadOverrideData();
        Automation.checkHealth(false).then(renderAutomation);
      } else if (isFirstLoad || incidents.length === 0) {
        listEl.innerHTML = emptyStateHtml(
          "Emergencies could not be loaded",
          describeError(incRes.reason),
          RETRY_HTML.replace("btn-outline btn-sm", "btn-primary")
        );
        fleetEl.innerHTML = "<tr><td colspan=\"4\" class=\"muted\">Not available.</td></tr>";
      }
    } finally {
      loading = false;
    }
  }

  // ---- Rendering -----------------------------------------------------------------
  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function renderAll() {
    renderStats();
    renderFilterCounts();
    renderIncidents();
    renderFleet();
    renderAutomation();
  }

  function renderStats() {
    setText("stat-active", incidents.filter(FILTERS.ACTIVE).length);
    setText("stat-high", incidents.filter(FILTERS.HIGH).length);
    setText("stat-awaiting", incidents.filter(FILTERS.AWAITING).length);
    setText("stat-ambulances", ambulancesLoaded
      ? ambulances.filter(function (a) { return a.status === "AVAILABLE"; }).length
      : "–");
  }

  function renderFilterCounts() {
    document.querySelectorAll(".filter-btn").forEach(function (btn) {
      const key = btn.getAttribute("data-filter");
      const base = btn.getAttribute("data-label") || btn.textContent.replace(/\s*\d+$/, "").trim();
      btn.setAttribute("data-label", base);
      btn.innerHTML = escapeHtml(base) + "<span class=\"count\">" + incidents.filter(FILTERS[key]).length + "</span>";
      btn.classList.toggle("active", key === activeFilter);
    });
  }

  function findAmbulance(id) {
    return ambulances.find(function (a) { return a.ambulance_id === id; }) || null;
  }

  function incidentCard(inc) {
    const done = inc.status === "HOSPITAL_ARRIVED";
    const query = "?id=" + encodeURIComponent(inc.incident_id);
    const amb = inc.ambulance_id ? findAmbulance(inc.ambulance_id) : null;

    const ambulanceText = inc.ambulance_id
      ? escapeHtml(inc.ambulance_id) + (amb ? " <span class=\"muted\">&middot; " + escapeHtml(amb.vehicle_number) + "</span>" : "")
      : "<span class=\"muted\">Not assigned</span>";

    const sev = String(inc.severity || "UNKNOWN").replace(/[^A-Z]/gi, "").toUpperCase();

    const dispatchBtn = inc.ambulance_id
      ? "<a class=\"btn btn-outline btn-sm\" href=\"ambulance.html" + query + "\">AMBULANCE STATUS</a>"
      : "<a class=\"btn btn-danger btn-sm" + (done ? " is-disabled" : "") + "\" href=\"ambulance.html" + query + "\">" +
        (AUTO_DISPATCH_ENABLED ? "MANUAL DISPATCH" : "DISPATCH AMBULANCE") + "</a>";

    let autoLine = "";
    if (AUTO_DISPATCH_ENABLED && !done) {
      const st = getAutomationState(inc.incident_id);
      const text = st.auto_mode === "OVERRIDE" ? "MANUAL OVERRIDE: automation paused for this incident."
        : (st.blocked ? st.blocked.reason : (st.steps.received ? "AUTO MODE: ON" : "Automation: not started yet."));
      autoLine = "<p class=\"hint\" style=\"margin-top:10px\"><span class=\"auto-pill\">AUTO</span> " + escapeHtml(text) + "</p>";
    }

    return "" +
      "<article class=\"incident-card card-sev-" + sev + (done ? " is-done" : "") + "\">" +
        "<header>" +
          "<div>" +
            "<span class=\"incident-id\">" + escapeHtml(inc.incident_id) + "</span>" +
            "<span class=\"incident-time\">" + escapeHtml(formatDateTime(inc.emergency_time)) +
              (inc.emergency_time ? " &middot; " + escapeHtml(timeAgo(inc.emergency_time)) : "") + "</span>" +
          "</div>" +
          severityBadge(inc.severity) +
        "</header>" +
        "<div class=\"incident-body\">" +
          "<dl class=\"detail-grid\">" +
            "<div><dt>Patient</dt><dd>" + escapeHtml(valueOrNA(inc.patient_name)) + "</dd></div>" +
            "<div><dt>Location</dt><dd>" + escapeHtml(valueOrNA(inc.location)) + "</dd></div>" +
            "<div><dt>Status</dt><dd>" + statusBadge(inc.status) + "</dd></div>" +
            "<div><dt>Ambulance</dt><dd>" + ambulanceText + "</dd></div>" +
            "<div><dt>Blood group</dt><dd>" + escapeHtml(valueOrNA(inc.blood_group, "Unknown")) + "</dd></div>" +
            "<div><dt>Allergy</dt><dd>" + escapeHtml(valueOrNA(inc.allergy, "Unknown")) + "</dd></div>" +
          "</dl>" + autoLine +
        "</div>" +
        "<footer>" +
          "<a class=\"btn btn-primary btn-sm\" href=\"incident.html" + query + "\">VIEW INCIDENT</a>" +
          dispatchBtn +
          "<a class=\"btn btn-outline btn-sm\" href=\"tracking.html" + query + "\">TRACKING</a>" +
          "<a class=\"btn btn-outline btn-sm\" href=\"hospital.html" + query + "\">HOSPITAL</a>" +
          "<a class=\"btn btn-outline btn-sm\" href=\"notification.html" + query + "\">NOTIFICATION</a>" +
        "</footer>" +
      "</article>";
  }

  function renderIncidents() {
    const rule = FILTERS[activeFilter] || FILTERS.ALL;
    const shown = incidents.filter(rule).slice().sort(function (a, b) {
      const sa = SEVERITY_ORDER[a.severity] === undefined ? 3 : SEVERITY_ORDER[a.severity];
      const sb = SEVERITY_ORDER[b.severity] === undefined ? 3 : SEVERITY_ORDER[b.severity];
      if (sa !== sb) return sa - sb;                                  // most severe first
      return new Date(a.emergency_time) - new Date(b.emergency_time); // then oldest first
    });

    if (shown.length === 0) {
      listEl.innerHTML = emptyStateHtml(
        incidents.length === 0 ? "No emergencies yet" : "Nothing in this view",
        incidents.length === 0
          ? "New emergencies appear here as soon as Member 1 and Member 2 create and verify them."
          : "Try another filter to see more emergencies."
      );
      return;
    }
    listEl.innerHTML = shown.map(incidentCard).join("");
  }

  function renderFleet() {
    if (!ambulancesLoaded) {
      fleetEl.innerHTML = "<tr><td colspan=\"4\" class=\"muted\">Ambulance data is not available right now.</td></tr>";
      return;
    }
    if (ambulances.length === 0) {
      fleetEl.innerHTML = "<tr><td colspan=\"4\" class=\"muted\">No ambulances registered.</td></tr>";
      return;
    }
    fleetEl.innerHTML = ambulances.map(function (a) {
      const incidentCell = a.incident_id
        ? "<a href=\"incident.html?id=" + encodeURIComponent(a.incident_id) + "\">" + escapeHtml(a.incident_id) + "</a>"
        : "<span class=\"muted\">&mdash;</span>";
      return "<tr>" +
        "<td><strong>" + escapeHtml(a.ambulance_id) + "</strong></td>" +
        "<td>" + escapeHtml(valueOrNA(a.vehicle_number)) + "</td>" +
        "<td>" + statusBadge(a.status) + "</td>" +
        "<td>" + incidentCell + "</td>" +
        "</tr>";
    }).join("");
  }


  // ============================================================================================
  // AUTOMATION PANEL
  // ============================================================================================
  const AUTO = AUTO_DISPATCH_ENABLED;
  let focusId = null;
  let focusPinned = false;                         // true once the operator picks an incident in the drop-down
  let overrideData = { forId: null, ambulances: [], hospitals: [] };

  function stateOf(id) { return getAutomationState(id); }
  function focusIncident() { return incidents.find(function (i) { return i.incident_id === focusId; }) || null; }
  function el(id) { return document.getElementById(id); }

  function pickFocus() {
    if (focusPinned && focusIncident()) return;
    let best = null, bestTime = 0;
    incidents.forEach(function (i) {
      const st = stateOf(i.incident_id);
      const t = st.updated_at ? Date.parse(st.updated_at) : 0;
      if (st.log.length > 0 && t > bestTime && i.status !== "HOSPITAL_ARRIVED") { best = i; bestTime = t; }
    });
    if (!best) {
      best = incidents.filter(FILTERS.ACTIVE).sort(function (a, b) {
        const sa = SEVERITY_ORDER[a.severity] === undefined ? 3 : SEVERITY_ORDER[a.severity];
        const sb = SEVERITY_ORDER[b.severity] === undefined ? 3 : SEVERITY_ORDER[b.severity];
        return sa - sb;
      })[0] || incidents[0] || null;
    }
    focusId = best ? best.incident_id : null;
  }

  function modeBadge(mode) {
    const info = Rules.modeInfo(mode);
    return "<span class=\"mode-badge " + info.css + "\" title=\"" + escapeHtml(info.long) + "\">" + escapeHtml(info.short) + "</span>";
  }

  function chip(label, value, note, cls) {
    return "<div class=\"auto-chip " + cls + "\"><span class=\"k\">" + escapeHtml(label) + "</span>" +
           "<span class=\"v\">" + escapeHtml(value) + "</span><span class=\"n\">" + escapeHtml(note) + "</span></div>";
  }

  // ---- Banner + status chips -------------------------------------------------------------------
  function renderBanner() {
    const global = getGlobalAutomation();
    const banner = el("auto-banner");
    if (!AUTO) {
      banner.className = "auto-banner is-off";
      banner.innerHTML = "<div><div class=\"auto-banner-title\">MANUAL MODE &mdash; AUTO-DISPATCH OFF</div>" +
        "<div class=\"auto-banner-sub\">AUTO_DISPATCH_ENABLED is false in api.js. Use the Incident / Ambulance / Hospital pages as before.</div></div>";
      return;
    }
    const focus = focusIncident();
    const st = focus ? stateOf(focus.incident_id) : null;
    const decision = st && st.decision_mode ? modeBadge(st.decision_mode) : "";
    if (global.paused) {
      banner.className = "auto-banner is-paused";
      banner.innerHTML = "<div><div class=\"auto-banner-title\">&#9208; AUTO-DISPATCH PAUSED</div>" +
        "<div class=\"auto-banner-sub\">The operator paused all automation. Nothing will be dispatched automatically.</div></div>" +
        "<button class=\"btn btn-success btn-sm\" type=\"button\" data-action=\"global-resume\">RESUME AUTO-DISPATCH</button>";
      return;
    }
    banner.className = "auto-banner";
    banner.innerHTML = "<div><div class=\"auto-banner-title\">&#129302; AUTO-DISPATCH ACTIVE</div>" +
      "<div class=\"auto-banner-sub\">AUTO MODE: ON &middot; verified " + escapeHtml(AUTOMATION_CONFIG.autoDispatchSeverities.join("/")) +
      " incidents are dispatched automatically &middot; " + (AI_ENABLED ? "AI-assisted with safe fallback" : "local rules only (AI off)") + "</div></div>" +
      "<div class=\"btn-row\" style=\"align-items:center\">" + decision +
      "<button class=\"btn btn-ghost-danger btn-sm\" type=\"button\" data-action=\"global-pause\">PAUSE ALL AUTOMATION</button></div>";
  }

  function renderChips() {
    const h = Automation.getHealth();
    const global = getGlobalAutomation();
    let engine;
    if (!AUTO && !AI_ENABLED) engine = chip("AI EMS engine", "DISABLED", "AI_ENABLED = false", "off");
    else if (!AI_ENABLED) engine = chip("AI EMS engine", "DISABLED", "local rules in use", "off");
    else if (h.status === "ONLINE") engine = chip("AI EMS engine", "ONLINE", h.llm_configured ? "scoring engine + LLM" : "scoring engine (no LLM key set)", "ok");
    else if (h.status === "DEGRADED") engine = chip("AI EMS engine", "DEGRADED", "service replied oddly", "warn");
    else if (h.status === "OFFLINE") engine = chip("AI EMS engine", "OFFLINE", "AI unavailable — safe fallback in use", "bad");
    else engine = chip("AI EMS engine", "CHECKING…", "", "off");

    const dispatch = !AUTO ? chip("Auto dispatch", "OFF", "manual mode", "off")
      : global.paused ? chip("Auto dispatch", "PAUSED", "operator pause", "warn")
      : chip("Auto dispatch", "ACTIVE", "AUTO MODE: ON", "ok");

    let hosp;
    if (!AUTO) hosp = chip("AI hospital recommendation", "OFF", "manual mode", "off");
    else if (!AI_ENABLED) hosp = chip("AI hospital recommendation", "RULES ONLY", "AI disabled", "warn");
    else if (h.status === "ONLINE") hosp = chip("AI hospital recommendation", "ACTIVE", "validated by safety rules", "ok");
    else hosp = chip("AI hospital recommendation", "FALLBACK", "nearest suitable hospital", "warn");

    const moving = incidents.filter(function (i) { return i.ambulance_id && i.status !== "HOSPITAL_ARRIVED"; }).length;
    const tracking = moving > 0 ? chip("Tracking", "ACTIVE", "DEMO / SIMULATED GPS · " + moving + " ambulance" + (moving === 1 ? "" : "s"), "ok")
                                : chip("Tracking", "STANDBY", "DEMO / SIMULATED GPS", "off");
    el("auto-chips").innerHTML = engine + dispatch + hosp + tracking;
  }

  // ---- Focus selector ------------------------------------------------------------------------------
  function renderFocusSelect() {
    const select = el("auto-focus");
    if (document.activeElement === select) return;
    select.innerHTML = incidents.map(function (i) {
      return "<option value=\"" + escapeHtml(i.incident_id) + "\"" + (i.incident_id === focusId ? " selected" : "") + ">" +
             escapeHtml(incidentOptionLabel(i)) + "</option>";
    }).join("") || "<option value=\"\">No incidents</option>";
  }

  // ---- Current emergency ------------------------------------------------------------------------------
  function renderCurrent(inc, st) {
    if (!inc) {
      el("auto-current").innerHTML = emptyStateHtml("No incident", "Nothing to monitor yet. Verified emergencies from Member 2 appear here automatically.");
      el("auto-mode-badge").innerHTML = "";
      return;
    }
    const query = "?id=" + encodeURIComponent(inc.incident_id);
    el("auto-mode-badge").innerHTML = !AUTO ? "<span class=\"mode-badge manual\">MANUAL MODE</span>"
      : (st.auto_mode === "ON" ? "<span class=\"mode-badge on\">AUTO MODE: ON</span>" : "<span class=\"mode-badge override\">MANUAL OVERRIDE</span>");
    el("auto-current").innerHTML =
      "<dl class=\"detail-grid\">" +
        "<div><dt>Incident ID</dt><dd class=\"mono\">" + escapeHtml(inc.incident_id) + "</dd></div>" +
        "<div><dt>Severity</dt><dd>" + severityBadge(inc.severity) + "</dd></div>" +
        "<div><dt>Location</dt><dd>" + escapeHtml(valueOrNA(inc.location)) + "</dd></div>" +
        "<div><dt>Patient</dt><dd>" + escapeHtml(valueOrNA(inc.patient_name)) + "</dd></div>" +
        "<div><dt>Current status</dt><dd>" + statusBadge(inc.status) + "</dd></div>" +
        "<div><dt>Needs</dt><dd>" + escapeHtml(Rules.needsLabel(inc)) + "</dd></div>" +
      "</dl>" +
      (st.blocked ? "<div class=\"blocked-note\">" + escapeHtml(st.blocked.reason) + "</div>" : "") +
      "<div class=\"btn-row\" style=\"margin-top:12px\">" +
        "<a class=\"btn btn-primary btn-sm\" href=\"incident.html" + query + "\">VIEW INCIDENT</a>" +
        "<a class=\"btn btn-outline btn-sm\" href=\"tracking.html" + query + "\">TRACKING</a></div>";
  }

  // ---- AI recommendation -----------------------------------------------------------------------------------
  function scoreText(v) { return typeof v === "number" ? "score " + v + "/100" : "no score (fallback rules)"; }

  function renderReco(inc, st) {
    if (!inc) { el("auto-reco").innerHTML = ""; return; }
    const a = st.ambulance_recommendation;
    const h = st.hospital_recommendation;
    let html = "";

    html += "<div class=\"reco-block\"><div class=\"reco-head\"><span class=\"reco-title\">Recommended ambulance</span>" + (a ? modeBadge(a.mode) : "") + "</div>";
    if (a) {
      html += "<div class=\"reco-main\">" + escapeHtml(a.recommended_ambulance) + "</div>" +
        "<div class=\"reco-meta\">" + escapeHtml(scoreText(a.ambulance_score)) +
        (typeof a.estimated_eta_minutes === "number" ? " &middot; ETA " + a.estimated_eta_minutes + " min (distance &divide; assumed speed, no live traffic)" : "") + "</div>" +
        "<div class=\"reco-reason\">" + escapeHtml(a.reason) + "</div>" +
        (a.notice ? "<div class=\"reco-notice\">" + escapeHtml(a.notice) + "</div>" : "") +
        (inc.ambulance_id && inc.ambulance_id !== a.recommended_ambulance
          ? "<div class=\"reco-notice\">Operator override: " + escapeHtml(inc.ambulance_id) + " is assigned instead of the recommended " + escapeHtml(a.recommended_ambulance) + ".</div>" : "");
    } else {
      html += "<div class=\"reco-meta\">" + (AUTO ? "Waiting for a verified incident to analyse." : "Automation is off.") + "</div>";
    }
    html += "</div>";

    html += "<div class=\"reco-block\"><div class=\"reco-head\"><span class=\"reco-title\">Recommended hospital</span>" + (h ? modeBadge(h.mode) : "") + "</div>";
    if (h) {
      html += "<div class=\"reco-main\">" + escapeHtml(h.recommended_hospital) + " &middot; " + escapeHtml(h.hospital_name) + "</div>" +
        "<div class=\"reco-meta\">" + escapeHtml(scoreText(h.hospital_score)) +
        (typeof h.estimated_eta_minutes === "number" ? " &middot; ETA from scene " + h.estimated_eta_minutes + " min" : "") + "</div>" +
        "<div class=\"reco-reason\">" + escapeHtml(h.hospital_reason) + "</div>" +
        (h.notice ? "<div class=\"reco-notice\">" + escapeHtml(h.notice) + "</div>" : "") +
        (inc.hospital_id && inc.hospital_id !== h.recommended_hospital
          ? "<div class=\"reco-notice\">Operator override: " + escapeHtml(inc.hospital_id) + " is assigned instead of the recommended " + escapeHtml(h.recommended_hospital) + ".</div>" : "");
    } else {
      html += "<div class=\"reco-meta\">Hospital is recommended right after the ambulance is dispatched.</div>";
    }
    html += "</div>";
    el("auto-reco").innerHTML = html;
  }

  // ---- AI EMS summary ------------------------------------------------------------------------------------------
  function renderSummary(inc, st) {
    const badge = el("auto-summary-badge");
    if (!inc) { el("auto-summary").innerHTML = ""; badge.innerHTML = ""; return; }
    let text, source;
    if (st.summary && st.summary.text) { text = st.summary.text; source = st.summary.source; }
    else {
      const h = inc.hospital_id ? (st.hospital_recommendation ? st.hospital_recommendation.hospital_name : inc.hospital_id) : null;
      text = Rules.buildTemplateSummary({ incident: inc, ambulanceId: inc.ambulance_id, etaMinutes: null, hospitalName: h,
        notification: st.notification, autoMode: st.auto_mode, decisionMode: st.decision_mode });
      source = "TEMPLATE";
    }
    badge.innerHTML = source === "LLM"
      ? "<span class=\"mode-badge ai\" title=\"Written by an LLM from non-medical facts\">LLM-WRITTEN</span>"
      : "<span class=\"mode-badge manual\" title=\"Built from a fixed template: no LLM key configured or LLM unavailable\">TEMPLATE (NO LLM)</span>";
    el("auto-summary").innerHTML = "<p class=\"summary-text\">" + escapeHtml(text) + "</p>" +
      "<p class=\"hint\" style=\"margin-top:8px\">Updates automatically as the incident changes. Tracking is simulated; face match is not absolute proof.</p>";
  }

  // ---- Timeline -----------------------------------------------------------------------------------------------------
  function renderTimeline(inc, st) {
    if (!inc) { el("auto-timeline").innerHTML = ""; return; }
    const idx = function (x) { return INCIDENT_STATUS_FLOW.indexOf(x); };
    const ci = idx(inc.status);
    const n = st.notification;
    const notifTag = n === "FAILED" ? { t: "FAILED", c: "bad" } : n === "PARTIAL" ? { t: "PARTIAL", c: "warn" } : n === "SKIPPED" ? { t: "no contacts", c: "warn" } : n === "SENT_SIMULATED" ? { t: "simulated", c: "" } : null;
    const steps = [
      { label: "Incident received", done: !!st.steps.received, at: st.steps.received },
      { label: "Incident verified", done: !!st.steps.verified || inc.identity_verified === true, at: st.steps.verified },
      { label: "AI analysis completed", done: !!st.steps.ai_analysis, at: st.steps.ai_analysis },
      { label: "Ambulance selected", done: !!st.steps.ambulance_selected || !!inc.ambulance_id, at: st.steps.ambulance_selected },
      { label: "Ambulance assigned", done: !!inc.ambulance_id, at: st.steps.ambulance_assigned, tag: inc.ambulance_id ? { t: inc.ambulance_id, c: "" } : null },
      { label: "Family notification initiated", done: !!st.steps.notified && n !== "NOT_STARTED", at: st.steps.notified, tag: notifTag },
      { label: "Hospital selected", done: !!inc.hospital_id, at: st.steps.hospital_selected, tag: inc.hospital_id ? { t: inc.hospital_id, c: "" } : null },
      { label: "Patient picked up", done: ci >= idx("PATIENT_PICKED_UP") },
      { label: "Hospital arrived", done: inc.status === "HOSPITAL_ARRIVED" }
    ];
    const firstPending = steps.findIndex(function (x) { return !x.done; });
    el("auto-timeline").innerHTML = "<ol class=\"timeline\">" + steps.map(function (step, i) {
      let cls = step.done ? "done" : "pending";
      if (i === firstPending) cls += " current";
      if (step.done && steps[i + 1] && steps[i + 1].done) cls += " link-done";
      return "<li class=\"" + cls + "\"><span class=\"tl-dot\" aria-hidden=\"true\">" + (step.done ? "✓" : "○") + "</span>" +
        "<span class=\"tl-label\">" + escapeHtml(step.label) +
        (step.tag ? "<span class=\"tl-tag " + step.tag.c + "\">" + escapeHtml(step.tag.t) + "</span>" : "") +
        (step.done && step.at ? "<span class=\"tl-time\">" + escapeHtml(formatTime(step.at)) + "</span>" : "") + "</span></li>";
    }).join("") + "</ol>";
  }

  // ---- Activity log ---------------------------------------------------------------------------------------------------
  function renderLog(st) {
    const box = el("auto-log");
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    if (!st || st.log.length === 0) {
      box.innerHTML = "<li class=\"log-empty\">No automation activity yet for this incident.</li>";
      return;
    }
    box.innerHTML = st.log.map(function (l) {
      return "<li class=\"" + escapeHtml(l.level) + "\"><span class=\"t\">" + escapeHtml(formatTime(l.at)) + "</span>" +
        (l.actor === "OPERATOR" ? "<span class=\"who\">OPERATOR</span>" : "") +
        "<span class=\"x\">" + escapeHtml(l.text) + "</span></li>";
    }).join("");
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }

  // ---- Manual override panel ----------------------------------------------------------------------------------------------
  async function loadOverrideData() {
    if (!focusId) return;
    const id = focusId;
    const res = await Promise.allSettled([getAmbulances(id), getHospitals(id)]);
    if (id !== focusId) return;
    overrideData = {
      forId: id,
      ambulances: res[0].status === "fulfilled" ? res[0].value : [],
      hospitals: res[1].status === "fulfilled" ? res[1].value : []
    };
    renderOverride();
  }

  function renderOverride() {
    const box = el("auto-override");
    const inc = focusIncident();
    if (!inc) { box.innerHTML = "<p class=\"hint\">Select an incident to see operator controls.</p>"; return; }
    // Do not rebuild the controls while the operator is using one of the drop-downs.
    if (box.contains(document.activeElement) && document.activeElement.tagName === "SELECT") return;

    const st = stateOf(inc.incident_id);
    const done = inc.status === "HOSPITAL_ARRIVED";
    const hasAmb = !!inc.ambulance_id;
    const canSwapAmb = !done && (!hasAmb || inc.status === "ASSIGNED" || inc.status === "EN_ROUTE");
    const next = getNextStatusAction(inc.status);
    const needsHospital = next && next.next === "TO_HOSPITAL" && !inc.hospital_id;
    const data = overrideData.forId === inc.incident_id ? overrideData : { ambulances: [], hospitals: [] };

    const prevAmb = el("ov-amb") ? el("ov-amb").value : "";
    const prevHosp = el("ov-hosp") ? el("ov-hosp").value : "";

    const ambOptions = "<option value=\"\">— choose ambulance —</option>" + data.ambulances.map(function (a) {
      const usable = a.status === "AVAILABLE" && !a.incident_id;
      const km = typeof a.distance_km === "number" ? " · " + a.distance_km.toFixed(1) + " km" : "";
      return "<option value=\"" + escapeHtml(a.ambulance_id) + "\"" + (usable ? "" : " disabled") + ">" + escapeHtml(a.ambulance_id) + " · " +
        escapeHtml(valueOrNA(a.capability, "?")) + km + " · " + escapeHtml(statusLabel(a.status)) + (a.ambulance_id === inc.ambulance_id ? " (current)" : "") + "</option>";
    }).join("");

    const hospOptions = "<option value=\"\">— choose hospital —</option>" + data.hospitals.map(function (h) {
      const usable = h.emergency_department === "AVAILABLE";
      const km = typeof h.distance_km === "number" ? " · " + h.distance_km.toFixed(1) + " km" : "";
      const caps = (h.capabilities || []).length ? " · " + h.capabilities.join("/") : "";
      return "<option value=\"" + escapeHtml(h.hospital_id) + "\"" + (usable ? "" : " disabled") + ">" + escapeHtml(valueOrNA(h.name, h.hospital_id)) + km + caps +
        (usable ? "" : " · UNAVAILABLE") + (h.hospital_id === inc.hospital_id ? " (current)" : "") + "</option>";
    }).join("");

    const belowThreshold = AUTO && !hasAmb && !done && AUTOMATION_CONFIG.autoDispatchSeverities.indexOf(inc.severity) === -1 && !st.forced;
    const overrideOn = st.auto_mode === "OVERRIDE";

    box.innerHTML =
      "<div class=\"override-head\">" +
        "<div><strong class=\"mono\">" + escapeHtml(inc.incident_id) + "</strong> &middot; " +
          (!AUTO ? "<span class=\"mode-badge manual\">MANUAL MODE</span>" : overrideOn ? "<span class=\"mode-badge override\">MANUAL OVERRIDE</span>" : "<span class=\"mode-badge on\">AUTO MODE: ON</span>") + "</div>" +
        "<div class=\"btn-row\">" +
          (AUTO ? (overrideOn
            ? "<button class=\"btn btn-success\" type=\"button\" data-action=\"resume\">RESUME AUTO MODE</button>"
            : "<button class=\"btn btn-danger\" type=\"button\" data-action=\"override\">MANUAL OVERRIDE</button>") : "") +
          (belowThreshold ? "<button class=\"btn btn-primary\" type=\"button\" data-action=\"run-auto\">RUN AUTO-DISPATCH NOW</button>" : "") +
        "</div>" +
      "</div>" +
      "<p class=\"hint\" style=\"margin-bottom:14px\">Using any control below pauses automation for this incident and is written to the activity log. The backend still rejects invalid actions.</p>" +
      "<div class=\"override-grid\">" +
        "<div class=\"override-box\"><label for=\"ov-amb\">" + (hasAmb ? "Change ambulance" : "Choose ambulance") + "</label>" +
          "<select class=\"select\" id=\"ov-amb\"" + (canSwapAmb ? "" : " disabled") + ">" + ambOptions + "</select>" +
          "<button class=\"btn btn-primary btn-sm\" type=\"button\" data-action=\"assign-amb\"" + (canSwapAmb ? "" : " disabled") + ">" + (hasAmb ? "SWAP AMBULANCE" : "ASSIGN AMBULANCE") + "</button>" +
          (canSwapAmb ? "" : "<span class=\"hint\">" + (done ? "Incident completed." : "Ambulance can only be changed before it reaches the scene.") + "</span>") + "</div>" +
        "<div class=\"override-box\"><label for=\"ov-hosp\">" + (inc.hospital_id ? "Change hospital" : "Choose hospital") + "</label>" +
          "<select class=\"select\" id=\"ov-hosp\"" + (hasAmb && !done ? "" : " disabled") + ">" + hospOptions + "</select>" +
          "<button class=\"btn btn-primary btn-sm\" type=\"button\" data-action=\"assign-hosp\"" + (hasAmb && !done ? "" : " disabled") + ">" + (inc.hospital_id ? "CHANGE HOSPITAL" : "ASSIGN HOSPITAL") + "</button>" +
          (hasAmb ? "" : "<span class=\"hint\">Assign an ambulance first.</span>") + "</div>" +
        "<div class=\"override-box\"><label>Family notification</label>" +
          "<div class=\"small\">Status: <strong>" + escapeHtml(statusLabel(st.notification)) + "</strong> (simulated)</div>" +
          "<button class=\"btn btn-outline btn-sm\" type=\"button\" data-action=\"retry-notify\"" + (hasAmb ? "" : " disabled") + ">RETRY NOTIFICATION</button>" +
          "<a class=\"btn btn-outline btn-sm\" href=\"notification.html?id=" + encodeURIComponent(inc.incident_id) + "\">OPEN NOTIFICATION PAGE</a></div>" +
        "<div class=\"override-box\"><label>Change status</label>" +
          "<div class=\"small\">Current: " + statusBadge(inc.status) + "</div>" +
          (next ? "<button class=\"btn btn-primary btn-sm\" type=\"button\" data-action=\"advance\" data-next=\"" + escapeHtml(next.next) + "\"" + (needsHospital ? " disabled" : "") + ">" + escapeHtml(next.label) + "</button>"
                : "<span class=\"hint\">" + (hasAmb ? "No further status." : "Assign an ambulance first.") + "</span>") +
          (needsHospital ? "<span class=\"hint\">Select a hospital first.</span>" : "") +
          "<span class=\"hint\">Only the next valid status is offered; the backend enforces the order.</span></div>" +
      "</div>";

    if (prevAmb && el("ov-amb")) el("ov-amb").value = prevAmb;
    if (prevHosp && el("ov-hosp")) el("ov-hosp").value = prevHosp;
  }

  function renderAutomation() {
    renderBanner();
    renderChips();
    renderFocusSelect();
    const inc = focusIncident();
    const st = inc ? stateOf(inc.incident_id) : null;
    renderCurrent(inc, st || newAutomationState());
    renderReco(inc, st || newAutomationState());
    renderSummary(inc, st || newAutomationState());
    renderTimeline(inc, st || newAutomationState());
    renderLog(st);
    renderOverride();
  }

  // ---- Automation events ------------------------------------------------------------------------------------------------------
  async function runOperatorAction(button, work, okMessage) {
    setBusy(button, true);
    try {
      const result = await work();
      showToast((result && result.message) || okMessage, "success");
    } catch (err) {
      handleError(err, { toast: true });
    } finally {
      setBusy(button, false);
      await loadDashboard(false);
      loadOverrideData();
    }
  }

  el("auto-override").addEventListener("click", async function (event) {
    const btn = event.target.closest("[data-action]");
    if (!btn || !focusId) return;
    const id = focusId;
    const action = btn.getAttribute("data-action");

    if (action === "override") { Automation.takeManualControl(id); renderAutomation(); showToast("Manual override: automation paused for " + id + ".", "warning"); }
    else if (action === "resume") { Automation.resumeAuto(id); renderAutomation(); showToast("AUTO MODE resumed for " + id + ".", "success"); Automation.tick(); }
    else if (action === "run-auto") { Automation.runAutoDispatchNow(id); renderAutomation(); Automation.tick(); }
    else if (action === "assign-amb") {
      const value = el("ov-amb").value;
      if (!value) { showToast("Choose an ambulance first.", "warning"); return; }
      await runOperatorAction(btn, function () { return Automation.operatorAssignAmbulance(id, value); }, "Ambulance updated.");
    } else if (action === "assign-hosp") {
      const value = el("ov-hosp").value;
      if (!value) { showToast("Choose a hospital first.", "warning"); return; }
      await runOperatorAction(btn, function () { return Automation.operatorAssignHospital(id, value); }, "Hospital updated.");
    } else if (action === "retry-notify") {
      await runOperatorAction(btn, async function () {
        const r = await Automation.operatorRetryNotification(id);
        return { message: "Notification result: " + statusLabel(r) + " (simulated)." };
      }, "Notification retried.");
    } else if (action === "advance") {
      const next = btn.getAttribute("data-next");
      await runOperatorAction(btn, function () { return Automation.operatorAdvanceStatus(id, next); }, "Status updated to " + statusLabel(next) + ".");
    }
  });

  el("auto-banner").addEventListener("click", function (event) {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    if (action === "global-pause") { setGlobalAutomationPaused(true); showToast("All automation paused.", "warning"); renderAutomation(); }
    if (action === "global-resume") { setGlobalAutomationPaused(false); showToast("Auto-dispatch resumed.", "success"); renderAutomation(); Automation.tick(); }
  });

  el("auto-focus").addEventListener("change", function () {
    focusId = el("auto-focus").value || null;
    focusPinned = true;
    overrideData = { forId: null, ambulances: [], hospitals: [] };
    renderAutomation();
    loadOverrideData();
  });

  // Demo-only switch (mock mode): make the next automatic notification fail, to show failure handling + retry.
  if (USE_MOCK_API && AUTO) {
    el("demo-fail-row").hidden = false;
    el("demo-fail-toggle").checked = getGlobalAutomation().simulate_notify_failure === true;
    el("demo-fail-toggle").addEventListener("change", function () {
      setGlobalAutomationFlag("simulate_notify_failure", el("demo-fail-toggle").checked);
    });
  }

  // Live updates: every log line from automation.js redraws the panel; data is re-read at most once a second.
  let redrawTimer = null;
  let reloadTimer = null;
  window.addEventListener("automation:update", function () {
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(renderAutomation, 150);
    if (!reloadTimer) reloadTimer = setTimeout(function () { reloadTimer = null; loadDashboard(false); }, 900);
  });

  // ---- Events ----------------------------------------------------------------------
  document.getElementById("filter-bar").addEventListener("click", function (event) {
    const btn = event.target.closest(".filter-btn");
    if (!btn) return;
    activeFilter = btn.getAttribute("data-filter");
    renderFilterCounts();
    renderIncidents();
  });

  refreshBtn.addEventListener("click", async function () {
    setBusy(refreshBtn, true);
    await loadDashboard(false);
    setBusy(refreshBtn, false);
  });

  document.getElementById("page-alert").addEventListener("click", function (event) {
    if (event.target.closest("[data-action='retry']")) loadDashboard(true);
  });
  listEl.addEventListener("click", function (event) {
    if (event.target.closest("[data-action='retry']")) loadDashboard(true);
  });

  // "Reset demo data" only exists in mock mode
  if (USE_MOCK_API) {
    resetBtn.hidden = false;
    resetBtn.addEventListener("click", async function () {
      if (!window.confirm("Reset all demo data (incidents, ambulances, notifications) to the starting state?")) return;
      setBusy(resetBtn, true);
      try {
        await resetDemoData();                 // also clears the automation log and AUTO MODE settings
        focusPinned = false;
        overrideData = { forId: null, ambulances: [], hospitals: [] };
        showToast("Demo data has been reset. Auto-dispatch will pick up the verified emergency again.", "success");
        await loadDashboard(true);
      } catch (err) {
        handleError(err, { toast: true });
      } finally {
        setBusy(resetBtn, false);
      }
    });
  }

  // ---- Start ------------------------------------------------------------------------
  loadDashboard(true).then(function () { Automation.tick(); });
  setInterval(function () { loadDashboard(false); }, REFRESH_MS);
  // Automation heartbeat: finds newly verified incidents, dispatches them and follows them to the hospital.
  if (AUTO_DISPATCH_ENABLED) setInterval(function () { Automation.tick(); }, AUTOMATION_CONFIG.tickMs);
})();
