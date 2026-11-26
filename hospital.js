/* ============================================================================
   hospital.js  -  Hospital assignment page (hospital.html?id=INC-2026-0001)

   The operator picks a destination hospital. The choice is stored against
   the SAME incident_id through assignHospital() in api.js, so Member 4's
   hospital module can read the incoming emergency from that incident.
   Uses ONLY functions from api.js.
   ============================================================================ */
(function () {
  "use strict";

  initPage();

  const BACK_LINK = "<a href=\"index.html\">Back to dashboard</a>";

  const view = document.getElementById("hospital-view");
  const emptyEl = document.getElementById("hospital-empty");
  const stripEl = document.getElementById("incident-strip");
  const listEl = document.getElementById("hospital-list");
  const handoffEl = document.getElementById("handoff-card");
  const refreshBtn = document.getElementById("refresh-btn");

  let currentId = null;
  let incident = null;
  let hospitals = [];
  let lastAssignment = null;     // response of the last successful assignHospital() call

  // ---- Loading ------------------------------------------------------------------------
  async function load(id, silent) {
    currentId = id;

    if (!id) {
      clearAlert();
      view.hidden = true;
      emptyEl.innerHTML = emptyStateHtml(
        "No incident selected",
        "Choose an incident above to select the destination hospital.",
        "<a class=\"btn btn-primary\" href=\"index.html\">Go to dashboard</a>"
      );
      return;
    }

    if (!silent) {
      view.hidden = true;
      emptyEl.innerHTML = "<div class=\"loading-line\"><span class=\"spinner\"></span> Loading hospitals&hellip;</div>";
      lastAssignment = null;
    }

    try {
      incident = await getIncident(id);
      hospitals = await getHospitals(id);
      rememberIncident(id);
      clearAlert();
      emptyEl.innerHTML = "";
      view.hidden = false;
      render();
    } catch (err) {
      view.hidden = true;
      emptyEl.innerHTML = emptyStateHtml("Hospitals could not be loaded", describeError(err),
        "<a class=\"btn btn-primary\" href=\"index.html\">Back to dashboard</a>");
      handleError(err, { extraHtml: BACK_LINK });
    }
  }

  // ---- Rendering -----------------------------------------------------------------------
  function selectedHospital() {
    return incident && incident.hospital_id
      ? hospitals.find(function (h) { return h.hospital_id === incident.hospital_id; }) || null
      : null;
  }

  function renderStrip() {
    const query = "?id=" + encodeURIComponent(incident.incident_id);
    const hasAmbulance = !!incident.ambulance_id;
    stripEl.innerHTML =
      "<div class=\"btn-row\" style=\"justify-content:space-between;align-items:center\">" +
        "<div><strong class=\"mono\">" + escapeHtml(incident.incident_id) + "</strong> " +
          "<span class=\"muted\">&middot; " + escapeHtml(valueOrNA(incident.location)) + "</span></div>" +
        "<div class=\"btn-row\">" + severityBadge(incident.severity) + statusBadge(incident.status) + "</div>" +
      "</div>" +
      "<dl class=\"detail-grid\" style=\"margin-top:14px\">" +
        "<div><dt>Ambulance</dt><dd>" + (hasAmbulance ? escapeHtml(incident.ambulance_id) : "<span class=\"muted\">Not assigned</span>") + "</dd></div>" +
        "<div><dt>Selected hospital</dt><dd>" + (incident.hospital_id
            ? escapeHtml(selectedHospital() ? selectedHospital().name : incident.hospital_id)
            : "<span class=\"muted\">None yet</span>") + "</dd></div>" +
      "</dl>" +
      (hasAmbulance
        ? ""
        : "<div class=\"alert alert-warning\" style=\"margin-top:14px\"><span class=\"alert-icon\" aria-hidden=\"true\">!</span>" +
          "<div class=\"alert-body\">An ambulance must be assigned before a hospital can be selected. " +
          "<div class=\"alert-extra\"><a href=\"ambulance.html" + query + "\">Dispatch an ambulance</a></div></div></div>");
  }

  function hospitalCard(h) {
    const isSelected = incident.hospital_id === h.hospital_id;
    const available = h.emergency_department === "AVAILABLE";
    const completed = incident.status === "HOSPITAL_ARRIVED";
    const hasAmbulance = !!incident.ambulance_id;
    const canSelect = available && hasAmbulance && !completed && !isSelected;

    let hint = "";
    if (!available) hint = "Not accepting emergency patients right now.";
    else if (!hasAmbulance) hint = "Assign an ambulance first.";
    else if (completed) hint = "This incident is completed.";

    const distance = typeof h.distance_km === "number" ? h.distance_km.toFixed(1) + " km" : "—";
    const eta = (h.eta_minutes === null || h.eta_minutes === undefined) ? "—" : h.eta_minutes + " minutes";
    const specialties = (h.specialties || []).map(function (s) { return "<span class=\"chip\">" + escapeHtml(s) + "</span>"; }).join("");

    let button;
    if (isSelected) {
      button = "<button class=\"btn btn-success btn-block\" type=\"button\" disabled>✓ SELECTED</button>";
    } else {
      button = "<button class=\"btn btn-primary btn-block\" type=\"button\" data-action=\"select\" " +
        "data-hospital=\"" + escapeHtml(h.hospital_id) + "\"" + (canSelect ? "" : " disabled") + ">SELECT HOSPITAL</button>";
    }

    return "<article class=\"card unit-card" + (isSelected ? " is-selected" : "") + "\">" +
      "<div class=\"unit-head\">" +
        "<div><div class=\"unit-title\">" + escapeHtml(valueOrNA(h.name, h.hospital_id)) + "</div>" +
          "<div class=\"unit-sub mono\">" + escapeHtml(h.hospital_id) + "</div></div>" +
        statusBadge(available ? "AVAILABLE" : "UNAVAILABLE") +
      "</div>" +
      "<dl class=\"detail-grid\">" +
        "<div class=\"span-2\"><dt>Emergency department</dt><dd>" + escapeHtml(valueOrNA(h.emergency_department, "UNKNOWN")) + "</dd></div>" +
        "<div><dt>Distance</dt><dd>" + escapeHtml(distance) + "</dd></div>" +
        "<div><dt>ETA</dt><dd>" + escapeHtml(eta) + "</dd></div>" +
        (typeof h.beds_available === "number" ? "<div><dt>Beds available</dt><dd>" + h.beds_available + "</dd></div>" : "") +
      "</dl>" +
      (specialties ? "<div class=\"chips\">" + specialties + "</div>" : "") +
      "<div class=\"unit-actions\">" + button + (hint ? "<span class=\"hint\">" + escapeHtml(hint) + "</span>" : "") + "</div>" +
    "</article>";
  }

  // What Member 4 can read: the request we sent and the shared incident_id
  function renderHandoff() {
    const hospital = selectedHospital();
    if (!incident.hospital_id) {
      handoffEl.hidden = true;
      handoffEl.innerHTML = "";
      return;
    }
    const payload = {
      hospital_id: incident.hospital_id,
      ambulance_id: incident.ambulance_id,
      eta_minutes: incident.eta_minutes === undefined ? null : incident.eta_minutes
    };
    const query = "?id=" + encodeURIComponent(incident.incident_id);

    handoffEl.hidden = false;
    handoffEl.innerHTML =
      "<div class=\"card\">" +
        "<div class=\"card-head\"><h2>Incoming emergency for " + escapeHtml(hospital ? hospital.name : incident.hospital_id) + "</h2>" +
          statusBadge(incident.status) + "</div>" +
        "<div class=\"card-body\">" +
          "<div class=\"alert alert-success\" style=\"margin-bottom:14px\"><span class=\"alert-icon\" aria-hidden=\"true\">✓</span>" +
            "<div class=\"alert-body\">Hospital stored against <strong class=\"mono\">" + escapeHtml(incident.incident_id) + "</strong>. " +
            "Member 4's hospital module can retrieve this incoming emergency using the same incident ID.</div></div>" +
          "<dl class=\"detail-grid\">" +
            "<div><dt>Incident</dt><dd class=\"mono\">" + escapeHtml(incident.incident_id) + "</dd></div>" +
            "<div><dt>Ambulance</dt><dd>" + escapeHtml(valueOrNA(incident.ambulance_id)) + "</dd></div>" +
            "<div><dt>ETA to hospital</dt><dd>" + escapeHtml(payload.eta_minutes === null ? "Not available" : payload.eta_minutes + " minutes") + "</dd></div>" +
            "<div><dt>Patient status</dt><dd>" + statusBadge(incident.status) + "</dd></div>" +
          "</dl>" +
          "<p class=\"small muted\" style=\"margin:14px 0 6px\">Request sent: <span class=\"mono\">POST /api/incidents/" +
            escapeHtml(incident.incident_id) + "/hospital</span></p>" +
          "<pre class=\"payload\">" + escapeHtml(JSON.stringify(payload, null, 2)) + "</pre>" +
          "<div class=\"btn-row\" style=\"margin-top:14px\">" +
            "<a class=\"btn btn-primary\" href=\"tracking.html" + query + "\">TRACK AMBULANCE</a>" +
            "<a class=\"btn btn-outline\" href=\"incident.html" + query + "\">VIEW INCIDENT</a>" +
          "</div>" +
        "</div>" +
      "</div>";
  }

  function render() {
    renderStrip();
    if (hospitals.length === 0) {
      listEl.innerHTML = emptyStateHtml("No hospitals found", "There are no hospitals in the system yet.");
    } else {
      // Available hospitals first, nearest first
      const sorted = hospitals.slice().sort(function (a, b) {
        const fa = a.emergency_department === "AVAILABLE" ? 0 : 1;
        const fb = b.emergency_department === "AVAILABLE" ? 0 : 1;
        if (fa !== fb) return fa - fb;
        const da = typeof a.distance_km === "number" ? a.distance_km : Infinity;
        const db = typeof b.distance_km === "number" ? b.distance_km : Infinity;
        return da - db;
      });
      listEl.innerHTML = sorted.map(hospitalCard).join("");
    }
    renderHandoff();
  }

  // ---- Selecting a hospital ---------------------------------------------------------------
  async function selectHospital(hospitalId, button) {
    const hospital = hospitals.find(function (h) { return h.hospital_id === hospitalId; });
    if (!hospital) {
      showToast("Hospital not found. Please refresh the page.", "danger");
      return;
    }
    if (!incident.ambulance_id) {
      showAlert("Assign an ambulance before selecting a hospital.", "warning");
      return;
    }
    if (hospital.emergency_department !== "AVAILABLE") {
      showAlert(hospital.name + " is not accepting emergency patients right now. Please choose another hospital.", "danger");
      return;
    }

    setBusy(button, true);
    try {
      // Same body as the API contract: POST /api/incidents/{incident_id}/hospital
      lastAssignment = await assignHospital(currentId, {
        hospital_id: hospital.hospital_id,
        ambulance_id: incident.ambulance_id,
        eta_minutes: hospital.eta_minutes === undefined ? null : hospital.eta_minutes
      });
      recordOperatorAction(currentId, "Operator manually assigned " + hospital.name + " on the Hospitals page.");   // logs + pauses automation for this incident
      showToast(hospital.name + " selected. Hospital notified (simulated).", "success");
      await load(currentId, true);
      showAlert(
        hospital.name + " has been assigned to " + currentId + ". Ambulance " + incident.ambulance_id +
        " → ETA " + (hospital.eta_minutes === null || hospital.eta_minutes === undefined ? "n/a" : hospital.eta_minutes + " minutes") + ".",
        "success"
      );
    } catch (err) {
      handleError(err, { toast: true });
      await load(currentId, true).catch(function () {});
    } finally {
      setBusy(button, false);
    }
  }

  // ---- Events -----------------------------------------------------------------------------------
  listEl.addEventListener("click", function (event) {
    const btn = event.target.closest("[data-action='select']");
    if (btn) selectHospital(btn.getAttribute("data-hospital"), btn);
  });

  refreshBtn.addEventListener("click", async function () {
    setBusy(refreshBtn, true);
    await load(currentId, true);
    setBusy(refreshBtn, false);
  });

  // ---- Start ---------------------------------------------------------------------------------------
  async function start() {
    const selector = await setupIncidentSelector(function (id) { load(id, false); });
    await load(selector.selectedId, false);
  }
  start();
})();
