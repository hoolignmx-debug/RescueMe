/* ============================================================================
   tracking.js  -  Live ambulance tracking (tracking.html?id=INC-2026-0001)

   DEMO / SIMULATED TRACKING: positions come from the mock API's movement
   simulation (api.js). This is NOT real GPS tracking.

   The map asks getTracking() for new positions every few seconds and moves
   the ambulance marker. Uses ONLY functions from api.js.
   ============================================================================ */
(function () {
  "use strict";

  initPage();

  const POLL_MS = 3000;                     // how often the ambulance position is refreshed
  const BACK_LINK = "<a href=\"index.html\">Back to dashboard</a>";

  const section = document.getElementById("tracking-section");
  const emptyEl = document.getElementById("tracking-empty");
  const actionsEl = document.getElementById("tracking-actions");

  let currentId = null;
  let map = null;
  let markers = { emergency: null, ambulance: null, hospital: null, suggested: null };
  let routeLine = null;                     // dashed line: ambulance -> current destination
  let plannedLine = null;                   // faint line: emergency scene -> hospital
  let lastDestination = "";                 // used to re-fit the map when the destination changes
  let pollTimer = null;
  let requestInFlight = false;
  let suggestedHospital = null;             // nearest available hospital (only shown if none assigned)
  let mapUnavailable = false;

  // ---- Map helpers ------------------------------------------------------------------
  function pinIcon(cssClass, symbol) {
    return L.divIcon({
      className: "map-pin-wrap",
      html: "<div class=\"map-pin " + cssClass + "\">" + symbol + "</div>",
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -18]
    });
  }

  function createMap() {
    if (map) return true;
    if (typeof L === "undefined") {
      if (!mapUnavailable) {
        mapUnavailable = true;
        document.getElementById("map").innerHTML =
          "<div class=\"empty-state\" style=\"margin:20px\"><h3>Map could not be loaded</h3>" +
          "<p>The Leaflet map library needs an internet connection. Check your connection and refresh the page. " +
          "The tracking details above still work.</p></div>";
        showAlert("The map library (Leaflet) could not be loaded, so the map is not shown.", "warning");
      }
      return false;
    }
    map = L.map("map", { zoomControl: true }).setView([28.6139, 77.2090], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
    }).addTo(map);
    return true;
  }

  function hasCoords(p) {
    return p && typeof p.latitude === "number" && typeof p.longitude === "number";
  }

  function placeMarker(key, point, icon, popupHtml) {
    if (!hasCoords(point)) {
      if (markers[key]) { map.removeLayer(markers[key]); markers[key] = null; }
      return;
    }
    const latlng = [point.latitude, point.longitude];
    if (markers[key]) {
      markers[key].setLatLng(latlng);
      markers[key].setPopupContent(popupHtml);
    } else {
      markers[key] = L.marker(latlng, { icon: icon }).addTo(map).bindPopup(popupHtml);
    }
  }

  function removeLine(line) {
    if (line && map) map.removeLayer(line);
    return null;
  }

  function fitMap() {
    if (!map) return;
    const points = [];
    Object.keys(markers).forEach(function (k) {
      if (markers[k]) points.push(markers[k].getLatLng());
    });
    if (points.length === 0) return;
    if (points.length === 1) { map.setView(points[0], 15); return; }
    map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 16 });
  }

  // ---- Updating the map ------------------------------------------------------------------
  function updateMap(data) {
    if (!createMap()) return;
    const hospital = data.hospital_location;
    const popupBase = function (title, line) {
      return "<strong>" + escapeHtml(title) + "</strong><br>" + escapeHtml(line);
    };

    placeMarker("emergency", data.emergency_location, pinIcon("pin-emergency", "!"),
      popupBase("Emergency " + data.incident_id, valueOrNA(data.emergency_location && data.emergency_location.label, "Emergency location")));

    placeMarker("ambulance", data.ambulance_location, pinIcon("pin-ambulance", "+"),
      popupBase("Ambulance " + valueOrNA(data.ambulance_id, ""), "DEMO position (simulated)"));

    if (hospital) {
      placeMarker("hospital", hospital, pinIcon("pin-hospital", "H"), popupBase(valueOrNA(hospital.name, "Hospital"), "Assigned hospital"));
      placeMarker("suggested", null);
    } else if (suggestedHospital) {
      placeMarker("hospital", null);
      placeMarker("suggested", suggestedHospital, pinIcon("pin-suggested", "H"),
        popupBase(valueOrNA(suggestedHospital.name, "Hospital"), "Nearest available hospital (not assigned yet)"));
    } else {
      placeMarker("hospital", null);
      placeMarker("suggested", null);
    }

    // Planned path: scene -> hospital (faint). Simulated straight line, not a road route.
    plannedLine = removeLine(plannedLine);
    if (hasCoords(data.emergency_location) && hasCoords(hospital)) {
      plannedLine = L.polyline(
        [[data.emergency_location.latitude, data.emergency_location.longitude], [hospital.latitude, hospital.longitude]],
        { color: "#15803d", weight: 3, opacity: 0.35, dashArray: "2 8" }
      ).addTo(map);
    }

    // Live path: ambulance -> where it is going now (simulated straight line)
    routeLine = removeLine(routeLine);
    let target = null;
    if (data.destination === "INCIDENT") target = data.emergency_location;
    if (data.destination === "HOSPITAL") target = hospital;
    if (hasCoords(data.ambulance_location) && hasCoords(target)) {
      routeLine = L.polyline(
        [[data.ambulance_location.latitude, data.ambulance_location.longitude], [target.latitude, target.longitude]],
        { color: "#1d4ed8", weight: 5, opacity: 0.85, dashArray: "10 10" }
      ).addTo(map);
    }

    // Fit the whole picture the first time and whenever the destination changes
    const key = String(data.destination) + "|" + String(!!hospital);
    if (key !== lastDestination) {
      lastDestination = key;
      fitMap();
    }
  }

  // ---- Updating the summary tiles and buttons ---------------------------------------------
  function setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function updateSummary(data) {
    setHtml("t-incident", escapeHtml(data.incident_id));
    setHtml("t-location", escapeHtml(valueOrNA(data.emergency_location && data.emergency_location.label, " ")));

    if (data.ambulance_id) {
      setHtml("t-ambulance", escapeHtml(data.ambulance_id));
      setHtml("t-vehicle", escapeHtml(valueOrNA(data.vehicle_number, " ")));
      setHtml("t-status", statusBadge(data.ambulance_status));
    } else {
      setHtml("t-ambulance", "<span class=\"muted\">Not assigned</span>");
      setHtml("t-vehicle", " ");
      setHtml("t-status", statusBadge(data.status));
    }

    const hasDistance = typeof data.distance_remaining_km === "number";
    const toWhere = data.destination === "HOSPITAL" ? "to hospital" : "to incident";
    setHtml("t-distance", hasDistance ? escapeHtml(data.distance_remaining_km.toFixed(2) + " km remaining " + toWhere) : " ");

    if (data.eta_minutes === null || data.eta_minutes === undefined) {
      setHtml("t-eta", "–");
      setHtml("t-eta-sub", data.ambulance_id ? "Select a hospital to estimate" : "Waiting for an ambulance");
    } else if (data.eta_minutes === 0) {
      setHtml("t-eta", "Arrived");
      setHtml("t-eta-sub", data.destination === "HOSPITAL" ? "At the hospital" : "At the incident location");
    } else {
      setHtml("t-eta", escapeHtml(data.eta_minutes + " min"));
      setHtml("t-eta-sub", escapeHtml(toWhere.charAt(0).toUpperCase() + toWhere.slice(1)));
    }

    const speed = document.getElementById("t-speed-note");
    if (speed) {
      speed.textContent = data.demo_speed_multiplier
        ? "Demo speed: " + data.demo_speed_multiplier + "× real time" : "";
    }
  }

  function updateActions(data) {
    const query = "?id=" + encodeURIComponent(data.incident_id);

    if (!data.ambulance_id) {
      actionsEl.innerHTML =
        "<p class=\"hint\" style=\"margin-bottom:10px\">No ambulance is assigned to this incident yet.</p>" +
        "<a class=\"btn btn-danger\" href=\"ambulance.html" + query + "\">DISPATCH AMBULANCE</a>";
      return;
    }

    const action = getNextStatusAction(data.ambulance_status);
    let html = "<div class=\"btn-row\">";
    if (action) {
      const needsHospital = action.next === "TO_HOSPITAL" && !data.hospital_location;
      html += needsHospital
        ? "<button class=\"btn btn-primary\" type=\"button\" disabled>" + escapeHtml(action.label) + "</button>" +
          "<a class=\"btn btn-outline\" href=\"hospital.html" + query + "\">SELECT HOSPITAL FIRST</a>"
        : "<button class=\"btn btn-primary\" type=\"button\" data-action=\"advance\" data-next=\"" + escapeHtml(action.next) + "\">" +
          escapeHtml(action.label) + "</button>";
    } else {
      html += "<span><strong>Journey complete.</strong> The ambulance has arrived at the hospital.</span>";
    }
    html += "<a class=\"btn btn-outline\" href=\"incident.html" + query + "\">VIEW INCIDENT</a></div>";

    // Gentle hint when the simulated ambulance has reached its destination
    if (data.eta_minutes === 0 && action) {
      html += "<p class=\"hint\" style=\"margin-top:10px\">The ambulance has reached its destination. Press the button above to update the status.</p>";
    }

    // Do not rebuild the buttons while the operator is clicking one
    if (actionsEl.getAttribute("data-busy") === "1") return;
    actionsEl.innerHTML = html;
  }

  // ---- Loading ------------------------------------------------------------------------------
  async function findSuggestedHospital(id) {
    suggestedHospital = null;
    try {
      const hospitals = await getHospitals(id);
      const open = hospitals.filter(function (h) { return h.emergency_department === "AVAILABLE" && hasCoords(h); });
      open.sort(function (a, b) {
        const da = typeof a.distance_km === "number" ? a.distance_km : Infinity;
        const db = typeof b.distance_km === "number" ? b.distance_km : Infinity;
        return da - db;
      });
      suggestedHospital = open[0] || null;
    } catch (err) {
      suggestedHospital = null;       // not important enough to show an error
    }
  }

  async function refresh(isFirst) {
    if (!currentId || requestInFlight) return;
    requestInFlight = true;
    try {
      const data = await getTracking(currentId);
      if (!data || !data.incident_id) {
        throw new ApiError("Tracking data is missing for this incident.", "MISSING_DATA", 404);
      }
      if (!data.hospital_location && !suggestedHospital && isFirst) {
        await findSuggestedHospital(currentId);
      }
      rememberIncident(currentId);
      clearAlert();
      emptyEl.innerHTML = "";
      section.hidden = false;
      if (!map) createMap();
      if (map) map.invalidateSize();
      updateSummary(data);
      updateMap(data);
      updateActions(data);
    } catch (err) {
      handleError(err, { extraHtml: BACK_LINK });
      if (isFirst) {
        section.hidden = true;
        emptyEl.innerHTML = emptyStateHtml("Tracking is not available", describeError(err),
          "<a class=\"btn btn-primary\" href=\"index.html\">Back to dashboard</a>");
      }
    } finally {
      requestInFlight = false;
    }
  }

  function selectIncident(id) {
    currentId = id;
    clearInterval(pollTimer);
    lastDestination = "";
    suggestedHospital = null;
    if (map) {                                    // clear markers from the previous incident
      Object.keys(markers).forEach(function (k) {
        if (markers[k]) { map.removeLayer(markers[k]); markers[k] = null; }
      });
      routeLine = removeLine(routeLine);
      plannedLine = removeLine(plannedLine);
    }

    if (!id) {
      clearAlert();
      section.hidden = true;
      emptyEl.innerHTML = emptyStateHtml(
        "No incident selected",
        "Choose an incident above to see the ambulance on the map.",
        "<a class=\"btn btn-primary\" href=\"index.html\">Go to dashboard</a>"
      );
      return;
    }
    emptyEl.innerHTML = "<div class=\"loading-line\"><span class=\"spinner\"></span> Loading tracking&hellip;</div>";
    refresh(true).then(function () {
      pollTimer = setInterval(function () { refresh(false); }, POLL_MS);
    });
  }

  // ---- Events ---------------------------------------------------------------------------------
  actionsEl.addEventListener("click", async function (event) {
    const btn = event.target.closest("[data-action='advance']");
    if (!btn || !currentId) return;
    actionsEl.setAttribute("data-busy", "1");
    const ok = await advanceStatus(currentId, btn.getAttribute("data-next"), btn);
    actionsEl.removeAttribute("data-busy");
    if (ok) await refresh(false);
  });

  document.getElementById("recenter-btn").addEventListener("click", fitMap);

  // ---- Start ------------------------------------------------------------------------------------
  async function start() {
    const selector = await setupIncidentSelector(selectIncident);
    selectIncident(selector.selectedId);
  }
  start();
})();
