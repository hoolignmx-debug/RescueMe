/* ============================================================================
   incident.js  -  Incident details page (incident.html?id=INC-2026-0001)
   Reads the incident ID from the URL and shows the summary, the emergency
   timeline and the response actions. Uses ONLY functions from api.js.
   ============================================================================ */
(function () {
  "use strict";

  initPage();

  const REFRESH_MS = 5000;
  const view = document.getElementById("incident-view");

  let currentId = null;
  let busy = false;          // true while a status button is working (pauses auto-refresh)

  const BACK_LINK = "<a href=\"index.html\">Back to dashboard</a>";

  // ---- Start ---------------------------------------------------------------------
  async function start() {
    const selector = await setupIncidentSelector(function (id) { loadIncident(id, false); });
    await loadIncident(selector.selectedId, false);
    setInterval(function () {
      if (currentId && !busy) loadIncident(currentId, true);
    }, REFRESH_MS);
  }

  // ---- Loading -------------------------------------------------------------------
  function valueOf(result, fallback) {
    return result.status === "fulfilled" && result.value ? result.value : fallback;
  }

  async function loadIncident(id, silent) {
    currentId = id;

    if (!id) {
      clearAlert();
      view.innerHTML = emptyStateHtml(
        "No incident selected",
        "Choose an incident from the list above, or open one from the dashboard.",
        "<a class=\"btn btn-primary\" href=\"index.html\">Go to dashboard</a>"
      );
      return;
    }

    if (!silent) {
      view.innerHTML = "<div class=\"loading-line\"><span class=\"spinner\"></span> Loading incident&hellip;</div>";
    }

    try {
      const incident = await getIncident(id);

      // Secondary data: if it fails, the page still works.
      const extra = await Promise.allSettled([
        getAmbulances(),
        getHospitals(),
        incident.ambulance_id ? getTracking(id) : Promise.resolve(null)
      ]);

      rememberIncident(id);
      clearAlert();
      render(incident, valueOf(extra[0], []), valueOf(extra[1], []), valueOf(extra[2], null));
    } catch (err) {
      if (silent) {            // keep what is on screen, just tell the operator
        handleError(err);
        return;
      }
      view.innerHTML = emptyStateHtml(
        "Incident could not be loaded",
        describeError(err),
        "<a class=\"btn btn-primary\" href=\"index.html\">Back to dashboard</a>"
      );
      handleError(err, { extraHtml: BACK_LINK });
    }
  }

  // ---- Helpers for display ---------------------------------------------------------
  function etaText(incident, tracking) {
    if (incident.status === "HOSPITAL_ARRIVED") return "Arrived at hospital";
    if (tracking && tracking.eta_minutes !== null && tracking.eta_minutes !== undefined) {
      if (tracking.eta_minutes === 0) return "Reached destination";
      const where = tracking.destination === "HOSPITAL" ? "to hospital" : "to incident scene";
      return tracking.eta_minutes + " min (" + where + ")";
    }
    if (incident.eta_minutes !== null && incident.eta_minutes !== undefined) {
      return incident.eta_minutes + " min (estimated, to hospital)";
    }
    return "Not available yet";
  }

  function identityText(incident) {
    if (incident.identity_verified) {
      const pct = typeof incident.identity_confidence === "number"
        ? " (match confidence " + Math.round(incident.identity_confidence * 100) + "%)"
        : "";
      return "Verified through an AI-assisted face match" + pct + ". A face match is a probable identification, " +
             "not absolute proof, so medical staff must confirm the patient's identity.";
    }
    return "Identity not verified yet. Do not delay dispatch; medical details below may be incomplete.";
  }

  function timelineHtml(incident) {
    const history = incident.status_history || [];
    const currentIndex = INCIDENT_STATUS_FLOW.indexOf(incident.status);

    // Work out which steps are done
    const done = TIMELINE_STEPS.map(function (step) {
      const entry = history.find(function (h) { return h.status === step.status; });
      if (step.status === "IDENTITY_VERIFIED" && typeof incident.identity_verified === "boolean") {
        return incident.identity_verified;
      }
      return !!entry || currentIndex >= INCIDENT_STATUS_FLOW.indexOf(step.status);
    });

    return "<ol class=\"timeline\">" + TIMELINE_STEPS.map(function (step, index) {
      const entry = history.find(function (h) { return h.status === step.status; });
      const isCurrent = incident.status === step.status;
      let cls = done[index] ? "done" : "pending";
      if (isCurrent) cls += " current";
      if (done[index] && done[index + 1]) cls += " link-done";

      let note = "";
      if (done[index] && entry) note = formatTime(entry.at);
      else if (!done[index] && step.status === "IDENTITY_VERIFIED" && index < currentIndex) note = "Still pending";
      else if (isCurrent) note = "Current step";

      return "<li class=\"" + cls + "\">" +
        "<span class=\"tl-dot\" aria-hidden=\"true\">" + (done[index] ? "✓" : "○") + "</span>" +
        "<span class=\"tl-label\">" + escapeHtml(step.label) +
          (note ? "<span class=\"tl-time\">" + escapeHtml(note) + "</span>" : "") +
        "</span>" +
      "</li>";
    }).join("") + "</ol>";
  }

  function actionLink(label, href, cssClass, disabled, reason) {
    return "<a class=\"btn " + cssClass + (disabled ? " is-disabled" : "") + "\" href=\"" + href + "\"" +
      (disabled ? " aria-disabled=\"true\" tabindex=\"-1\"" : "") +
      (disabled && reason ? " title=\"" + escapeHtml(reason) + "\"" : "") + ">" + label + "</a>";
  }

  // ---- AI EMS summary + automation activity (read-only here; controls live on the dashboard) ----
  function automationCardHtml(incident, tracking, hospital) {
    const st = getAutomationState(incident.incident_id);
    const modeHtml = !AUTO_DISPATCH_ENABLED ? "<span class=\"mode-badge manual\">MANUAL MODE</span>"
      : st.auto_mode === "OVERRIDE" ? "<span class=\"mode-badge override\">MANUAL OVERRIDE</span>" : "<span class=\"mode-badge on\">AUTO MODE: ON</span>";
    let text, source;
    if (st.summary && st.summary.text) { text = st.summary.text; source = st.summary.source; }
    else {
      text = Rules.buildTemplateSummary({ incident: incident, ambulanceId: incident.ambulance_id,
        etaMinutes: tracking && typeof tracking.eta_minutes === "number" ? tracking.eta_minutes : null,
        hospitalName: hospital ? hospital.name : incident.hospital_id, notification: st.notification, autoMode: st.auto_mode, decisionMode: st.decision_mode });
      source = "TEMPLATE";
    }
    const modeInfo = st.decision_mode ? Rules.modeInfo(st.decision_mode) : null;
    const recent = st.log.slice(-6).map(function (l) {
      return "<li class=\"" + escapeHtml(l.level) + "\"><span class=\"t\">" + escapeHtml(formatTime(l.at)) + "</span>" +
        (l.actor === "OPERATOR" ? "<span class=\"who\">OPERATOR</span>" : "") + "<span class=\"x\">" + escapeHtml(l.text) + "</span></li>";
    }).join("");
    return "<section class=\"card\">" +
      "<div class=\"card-head\"><h2>AI EMS summary</h2><div class=\"btn-row\">" + modeHtml +
        (modeInfo ? "<span class=\"mode-badge " + modeInfo.css + "\" title=\"" + escapeHtml(modeInfo.long) + "\">" + escapeHtml(modeInfo.short) + "</span>" : "") + "</div></div>" +
      "<div class=\"card-body\"><p class=\"summary-text\">" + escapeHtml(text) + "</p>" +
        "<p class=\"hint\" style=\"margin:8px 0 12px\">" + (source === "LLM" ? "Written by an LLM from non-medical facts." : "Template summary (no LLM).") + " Full controls and log: <a href=\"index.html\">EMS dashboard</a>.</p>" +
        (recent ? "<ul class=\"log-list\">" + recent + "</ul>" : "") + "</div></section>";
  }

  // ---- Rendering ---------------------------------------------------------------------
  function render(incident, ambulances, hospitals, tracking) {
    const ambulance = incident.ambulance_id
      ? ambulances.find(function (a) { return a.ambulance_id === incident.ambulance_id; }) : null;
    const hospital = incident.hospital_id
      ? hospitals.find(function (h) { return h.hospital_id === incident.hospital_id; }) : null;

    const completed = incident.status === "HOSPITAL_ARRIVED";
    const hasAmbulance = !!incident.ambulance_id;
    const query = "?id=" + encodeURIComponent(incident.incident_id);
    const action = getNextStatusAction(incident.status);

    const ambulanceText = hasAmbulance
      ? escapeHtml(incident.ambulance_id) + (ambulance ? " <span class=\"muted\">&middot; " + escapeHtml(ambulance.vehicle_number) + "</span>" : "")
      : "<span class=\"muted\">Not assigned</span>";
    const hospitalText = incident.hospital_id
      ? escapeHtml(hospital ? hospital.name : incident.hospital_id)
      : "<span class=\"muted\">Not assigned</span>";

    // Progress section (next status button)
    let progressHtml;
    if (!hasAmbulance) {
      progressHtml = "<p class=\"hint\">Assign an ambulance to start the response.</p>";
    } else if (!action) {
      progressHtml = "<p><strong>Journey complete.</strong> The ambulance has arrived at the hospital.</p>";
    } else {
      const needsHospital = action.next === "TO_HOSPITAL" && !incident.hospital_id;
      progressHtml =
        "<p style=\"margin-bottom:10px\"><span class=\"muted\">Ambulance status:</span> " + statusBadge(incident.status) + "</p>" +
        (needsHospital
          ? "<button class=\"btn btn-primary btn-block\" type=\"button\" disabled>" + escapeHtml(action.label) + "</button>" +
            "<p class=\"hint\" style=\"margin-top:8px\">Select a destination hospital first (ASSIGN HOSPITAL).</p>"
          : "<button class=\"btn btn-primary btn-block\" type=\"button\" data-action=\"advance\" data-next=\"" + escapeHtml(action.next) + "\">" +
              escapeHtml(action.label) + "</button>");
    }

    // Mock-only helper: stands in for Member 2 verifying the patient's identity
    const verifyHtml = (USE_MOCK_API && incident.status === "EMERGENCY_CREATED")
      ? "<div style=\"margin-top:14px\"><button class=\"btn btn-outline btn-sm\" type=\"button\" data-action=\"verify-identity\">DEMO: mark identity verified</button>" +
        "<p class=\"hint\" style=\"margin-top:6px\">Mock mode only. In the real system Member 2 verifies identity.</p></div>"
      : "";

    view.innerHTML =
      "<div class=\"grid-2\">" +
        "<div class=\"stack\">" +
          // Summary card
          "<section class=\"card\">" +
            "<div class=\"card-head\"><h2 class=\"mono\">" + escapeHtml(incident.incident_id) + "</h2>" +
              "<div class=\"btn-row\">" + severityBadge(incident.severity) + statusBadge(incident.status) + "</div></div>" +
            "<div class=\"card-body\">" +
              "<dl class=\"detail-grid\">" +
                "<div><dt>Patient</dt><dd>" + escapeHtml(valueOrNA(incident.patient_name)) + "</dd></div>" +
                "<div><dt>Emergency severity</dt><dd>" + escapeHtml(valueOrNA(incident.severity)) + "</dd></div>" +
                "<div><dt>Location</dt><dd>" + escapeHtml(valueOrNA(incident.location)) + "</dd></div>" +
                "<div><dt>GPS coordinates</dt><dd class=\"mono\">" + escapeHtml(formatCoordinates(incident.latitude, incident.longitude)) + "</dd></div>" +
                "<div><dt>Blood group</dt><dd>" + escapeHtml(valueOrNA(incident.blood_group, "Unknown")) + "</dd></div>" +
                "<div><dt>Allergy</dt><dd>" + escapeHtml(valueOrNA(incident.allergy, "Unknown")) + "</dd></div>" +
                "<div><dt>Current status</dt><dd>" + statusBadge(incident.status) + "</dd></div>" +
                "<div><dt>Emergency time</dt><dd>" + escapeHtml(formatDateTime(incident.emergency_time)) +
                  " <span class=\"muted small\">" + escapeHtml(timeAgo(incident.emergency_time)) + "</span></dd></div>" +
                "<div><dt>Assigned ambulance</dt><dd>" + ambulanceText + "</dd></div>" +
                "<div><dt>Assigned hospital</dt><dd>" + hospitalText + "</dd></div>" +
                "<div><dt>ETA</dt><dd>" + escapeHtml(etaText(incident, tracking)) + "</dd></div>" +
                "<div class=\"span-2\"><dt>Identity</dt><dd class=\"small\" style=\"font-weight:500\">" + escapeHtml(identityText(incident)) + "</dd></div>" +
              "</dl>" +
            "</div>" +
          "</section>" +
          // Timeline
          "<section class=\"card\">" +
            "<div class=\"card-head\"><h2>Emergency timeline</h2></div>" +
            "<div class=\"card-body\">" + timelineHtml(incident) + "</div>" +
          "</section>" +
        "</div>" +

        "<div class=\"stack\">" +
          // Actions
          "<section class=\"card\">" +
            "<div class=\"card-head\"><h2>Response actions</h2></div>" +
            "<div class=\"card-body\">" +
              "<div class=\"stack\" style=\"gap:10px\">" +
                actionLink("DISPATCH AMBULANCE", "ambulance.html" + query, "btn-danger btn-block", hasAmbulance || completed,
                  completed ? "This incident is completed." : "An ambulance is already assigned.") +
                actionLink("TRACK AMBULANCE", "tracking.html" + query, "btn-primary btn-block", !hasAmbulance, "Assign an ambulance first.") +
                actionLink("NOTIFY FAMILY", "notification.html" + query, "btn-outline btn-block", false) +
                actionLink("ASSIGN HOSPITAL", "hospital.html" + query, "btn-outline btn-block", completed, "This incident is completed.") +
              "</div>" +
            "</div>" +
          "</section>" +
          automationCardHtml(incident, tracking, hospital) +
          // Progress
          "<section class=\"card\">" +
            "<div class=\"card-head\"><h2>Ambulance progress</h2></div>" +
            "<div class=\"card-body\" id=\"progress-box\">" + progressHtml + verifyHtml + "</div>" +
          "</section>" +
          // Hospital summary
          "<section class=\"card\">" +
            "<div class=\"card-head\"><h2>Destination hospital</h2></div>" +
            "<div class=\"card-body\">" +
              (incident.hospital_id
                ? "<p><strong>" + escapeHtml(hospital ? hospital.name : incident.hospital_id) + "</strong></p>" +
                  "<p class=\"hint\">Hospital ID " + escapeHtml(incident.hospital_id) + " &middot; Ambulance " + escapeHtml(valueOrNA(incident.ambulance_id, "—")) +
                  " &middot; ETA " + escapeHtml(incident.eta_minutes === null || incident.eta_minutes === undefined ? "—" : incident.eta_minutes + " min") + "</p>"
                : "<p class=\"hint\">No hospital selected yet.</p>") +
            "</div>" +
          "</section>" +
        "</div>" +
      "</div>";
  }

  // ---- Events (one listener for all buttons inside the view) ------------------------------
  view.addEventListener("click", async function (event) {
    const btn = event.target.closest("[data-action]");
    if (!btn || !currentId) return;
    const action = btn.getAttribute("data-action");

    if (action === "advance" || action === "verify-identity") {
      const next = action === "advance" ? btn.getAttribute("data-next") : "IDENTITY_VERIFIED";
      busy = true;
      const ok = await advanceStatus(currentId, next, btn);
      busy = false;
      if (ok) await loadIncident(currentId, true);
    }
  });

  start();
})();
