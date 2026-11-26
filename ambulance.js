/* ============================================================================
   ambulance.js  -  Ambulance page (ambulance.html?id=INC-2026-0001)
   Lists ambulances, assigns one to the chosen incident and moves it through
   the status flow. Uses ONLY functions from api.js.
   ============================================================================ */
(function () {
  "use strict";

  initPage();

  const listEl = document.getElementById("ambulance-list");
  const summaryEl = document.getElementById("incident-summary");
  const autoBtn = document.getElementById("auto-assign-btn");
  const refreshBtn = document.getElementById("refresh-btn");

  let currentId = null;
  let incident = null;       // the selected incident (or null)
  let ambulances = [];

  const BACK_LINK = "<a href=\"index.html\">Back to dashboard</a>";
  const SKELETONS = "<div class=\"skeleton\"></div><div class=\"skeleton\"></div>";

  // ---- Start ---------------------------------------------------------------------
  async function start() {
    const selector = await setupIncidentSelector(function (id) {
      currentId = id;
      loadAll({});
    });
    currentId = selector.selectedId;
    await loadAll({});
  }

  // ---- Loading -------------------------------------------------------------------
  // options.silent    : do not show the loading skeleton
  // options.keepAlert : do not clear the message at the top of the page
  async function loadAll(options) {
    options = options || {};
    if (!options.silent) listEl.innerHTML = SKELETONS;

    incident = null;
    let alertShown = false;

    if (currentId) {
      try {
        incident = await getIncident(currentId);
        rememberIncident(currentId);
      } catch (err) {
        handleError(err, { extraHtml: BACK_LINK });
        alertShown = true;
      }
    }

    try {
      ambulances = await getAmbulances(incident ? incident.incident_id : undefined);
      if (!alertShown && !options.keepAlert) clearAlert();
    } catch (err) {
      ambulances = [];
      handleError(err, { extraHtml: "<button type=\"button\" class=\"btn btn-outline btn-sm\" data-action=\"retry\">Try again</button>" });
      listEl.innerHTML = emptyStateHtml("Ambulances could not be loaded", describeError(err));
      renderSummary();
      return;
    }
    render();
  }

  // ---- Rendering -----------------------------------------------------------------
  function availableCount() {
    return ambulances.filter(function (a) { return a.status === "AVAILABLE"; }).length;
  }

  function incidentIsOpen() {
    return incident && !incident.ambulance_id && incident.status !== "HOSPITAL_ARRIVED";
  }

  function renderSummary() {
    let html = "";

    if (incident) {
      const query = "?id=" + encodeURIComponent(incident.incident_id);
      html += "<div class=\"card\" style=\"margin-bottom:18px\"><div class=\"card-body\">" +
        "<div class=\"btn-row\" style=\"align-items:center;justify-content:space-between\">" +
          "<div><strong class=\"mono\">" + escapeHtml(incident.incident_id) + "</strong> " +
            "<span class=\"muted\">&middot; " + escapeHtml(valueOrNA(incident.location)) + "</span></div>" +
          "<div class=\"btn-row\">" + severityBadge(incident.severity) + statusBadge(incident.status) +
            "<a class=\"btn btn-outline btn-sm\" href=\"incident.html" + query + "\">VIEW INCIDENT</a></div>" +
        "</div>" +
        (incident.ambulance_id
          ? "<p class=\"hint\" style=\"margin-top:8px\">This incident already has ambulance <strong>" + escapeHtml(incident.ambulance_id) + "</strong> assigned.</p>"
          : "") +
        "</div></div>";
    } else if (!currentId) {
      html += "<div class=\"alert alert-info\" style=\"margin-bottom:18px\"><span class=\"alert-icon\" aria-hidden=\"true\">i</span>" +
        "<div class=\"alert-body\">Select an incident above to assign an ambulance and see distance and ETA.</div></div>";
    }

    if (ambulances.length > 0 && availableCount() === 0) {
      html += "<div class=\"alert alert-warning\" style=\"margin-bottom:18px\"><span class=\"alert-icon\" aria-hidden=\"true\">!</span>" +
        "<div class=\"alert-body\">No ambulance is available right now. All units are assigned to other incidents.</div></div>";
    }

    summaryEl.innerHTML = html;
    autoBtn.disabled = !(incidentIsOpen() && availableCount() > 0);
  }

  function ambulanceCard(a) {
    const mine = incident && a.incident_id === incident.incident_id;
    const showDistance = (a.status === "AVAILABLE" || a.status === "ASSIGNED" || a.status === "EN_ROUTE") &&
                         typeof a.distance_km === "number";

    let locationText;
    let etaText;
    if (showDistance) {
      locationText = a.distance_km.toFixed(1) + " km from incident";
      etaText = (a.eta_minutes === null || a.eta_minutes === undefined) ? "—" : a.eta_minutes + " minutes";
    } else if (a.status === "AVAILABLE" && !incident) {
      locationText = "Select an incident to see distance";
      etaText = "—";
    } else {
      locationText = "—";
      etaText = "—";
    }

    let actions = "";
    if (a.status === "AVAILABLE") {
      const disabled = !incidentIsOpen();
      let reason = "";
      if (!incident) reason = "Select an incident first.";
      else if (incident.ambulance_id) reason = "This incident already has an ambulance.";
      else if (incident.status === "HOSPITAL_ARRIVED") reason = "This incident is completed.";
      actions = "<button class=\"btn btn-danger btn-block\" type=\"button\" data-action=\"assign\" data-ambulance=\"" + escapeHtml(a.ambulance_id) + "\"" +
        (disabled ? " disabled" : "") + ">ASSIGN AMBULANCE</button>" +
        (disabled && reason ? "<span class=\"hint\">" + escapeHtml(reason) + "</span>" : "");
    } else if (mine) {
      const next = getNextStatusAction(a.status);
      const query = "?id=" + encodeURIComponent(incident.incident_id);
      if (next) {
        const needsHospital = next.next === "TO_HOSPITAL" && !incident.hospital_id;
        actions += needsHospital
          ? "<button class=\"btn btn-primary btn-block\" type=\"button\" disabled>" + escapeHtml(next.label) + "</button>" +
            "<span class=\"hint\">Select a destination hospital first.</span>"
          : "<button class=\"btn btn-primary btn-block\" type=\"button\" data-action=\"advance\" data-next=\"" + escapeHtml(next.next) + "\">" +
            escapeHtml(next.label) + "</button>";
      } else {
        actions += "<span class=\"hint\">Journey complete.</span>";
      }
      actions += "<a class=\"btn btn-outline btn-sm\" href=\"tracking.html" + query + "\">TRACK AMBULANCE</a>";
    } else {
      actions = "<span class=\"hint\">Assigned to " + (a.incident_id ? escapeHtml(a.incident_id) : "another incident") + ".</span>" +
        (a.incident_id ? "<a class=\"btn btn-outline btn-sm\" href=\"incident.html?id=" + encodeURIComponent(a.incident_id) + "\">VIEW THAT INCIDENT</a>" : "");
    }

    return "<article class=\"card unit-card" + (mine ? " is-selected" : "") + "\">" +
      "<div class=\"unit-head\">" +
        "<div><div class=\"unit-title\">" + escapeHtml(a.ambulance_id) + "</div>" +
          "<div class=\"unit-sub\">Vehicle: " + escapeHtml(valueOrNA(a.vehicle_number)) + "</div></div>" +
        statusBadge(a.status) +
      "</div>" +
      "<dl class=\"detail-grid\">" +
        "<div><dt>Location</dt><dd>" + escapeHtml(locationText) + "</dd></div>" +
        "<div><dt>ETA</dt><dd>" + escapeHtml(etaText) + "</dd></div>" +
        "<div><dt>Capability</dt><dd>" + escapeHtml(valueOrNA(a.capability, "Unknown")) + "</dd></div>" +
        "<div><dt>Equipment</dt><dd class=\"small\">" + escapeHtml((a.equipment || []).join(", ") || "Unknown") + "</dd></div>" +
      "</dl>" +
      "<div class=\"unit-actions\">" + actions + "</div>" +
    "</article>";
  }

  function render() {
    renderSummary();

    if (ambulances.length === 0) {
      listEl.innerHTML = emptyStateHtml("No ambulances registered", "There are no ambulances in the system yet.");
      return;
    }

    // Available first (nearest first), then the others
    const sorted = ambulances.slice().sort(function (a, b) {
      const fa = a.status === "AVAILABLE" ? 0 : 1;
      const fb = b.status === "AVAILABLE" ? 0 : 1;
      if (fa !== fb) return fa - fb;
      const da = typeof a.distance_km === "number" ? a.distance_km : Infinity;
      const db = typeof b.distance_km === "number" ? b.distance_km : Infinity;
      return da - db;
    });
    listEl.innerHTML = sorted.map(ambulanceCard).join("");
  }

  // ---- Actions -----------------------------------------------------------------------
  async function assign(ambulanceId, button) {
    if (!incident) {
      showToast("Select an incident first.", "warning");
      return;
    }
    setBusy(button, true);
    try {
      const result = await dispatchAmbulance(incident.incident_id, ambulanceId);
      recordOperatorAction(incident.incident_id, "Operator manually assigned " + ambulanceId + " on the Ambulances page.");   // logs + pauses automation for this incident
      showToast((result && result.message) || (ambulanceId + " assigned."), "success");
      const query = "?id=" + encodeURIComponent(incident.incident_id);
      await loadAll({ silent: true });
      showAlert(
        ambulanceId + " is now assigned to " + currentId + ". Status changed from AVAILABLE to ASSIGNED.",
        "success",
        "<a href=\"incident.html" + query + "\">View incident</a>" +
        "<a href=\"notification.html" + query + "\">Notify family</a>" +
        "<a href=\"hospital.html" + query + "\">Assign hospital</a>"
      );
    } catch (err) {
      handleError(err, { toast: true });
      await loadAll({ silent: true, keepAlert: true });   // show the latest real state
    } finally {
      setBusy(button, false);
    }
  }

  async function autoAssign() {
    if (!incidentIsOpen()) return;
    const free = ambulances.filter(function (a) { return a.status === "AVAILABLE"; });
    if (free.length === 0) {
      const message = "No ambulance is available right now. All units are currently assigned.";
      showAlert(message, "danger", BACK_LINK);
      showToast(message, "danger");
      return;
    }
    // Nearest SUITABLE unit (an advanced unit for a HIGH incident), not simply the nearest one.
    const choice = Rules.fallbackRecommendAmbulance(incident, free);
    if (!choice.ok) {
      showAlert(choice.message, "danger", BACK_LINK);
      showToast(choice.message, "danger");
      return;
    }
    await assign(choice.value.recommended_ambulance, autoBtn);
  }

  // ---- Events --------------------------------------------------------------------------
  listEl.addEventListener("click", async function (event) {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");

    if (action === "assign") {
      await assign(btn.getAttribute("data-ambulance"), btn);
    } else if (action === "advance" && incident) {
      const ok = await advanceStatus(incident.incident_id, btn.getAttribute("data-next"), btn);
      if (ok) await loadAll({ silent: true });
    }
  });

  autoBtn.addEventListener("click", autoAssign);

  refreshBtn.addEventListener("click", async function () {
    setBusy(refreshBtn, true);
    await loadAll({ silent: true });
    setBusy(refreshBtn, false);
  });

  document.getElementById("page-alert").addEventListener("click", function (event) {
    if (event.target.closest("[data-action='retry']")) loadAll({});
  });

  start();
})();
