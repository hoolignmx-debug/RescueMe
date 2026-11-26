/* ============================================================================
   notification.js  -  Family notification page (notification.html?id=...)

   SIMULATION ONLY: nothing is sent by SMS, WhatsApp or phone. The buttons
   call sendNotification() in api.js, which just records a SIMULATED entry.
   Uses ONLY functions from api.js.
   ============================================================================ */
(function () {
  "use strict";

  initPage();

  const BACK_LINK = "<a href=\"index.html\">Back to dashboard</a>";

  const view = document.getElementById("notification-view");
  const emptyEl = document.getElementById("notification-empty");
  const contactListEl = document.getElementById("contact-list");
  const contactCountEl = document.getElementById("contact-count");
  const logBody = document.getElementById("log-body");
  const messageBox = document.getElementById("message-text");
  const resultsEl = document.getElementById("sim-results");
  const testFailureRow = document.getElementById("test-failure-row");
  const testFailure = document.getElementById("test-failure");

  const CHANNELS = {
    SMS:        { button: "btn-sms",      doneText: "SMS SIMULATED",                    label: "SMS" },
    WHATSAPP:   { button: "btn-whatsapp", doneText: "WhatsApp NOTIFICATION SIMULATED",  label: "WhatsApp" },
    VOICE_CALL: { button: "btn-voice",    doneText: "VOICE CALL SIMULATED",             label: "Voice call" }
  };

  let currentId = null;
  let incident = null;
  let contacts = [];
  let messageEdited = false;      // true once the operator types their own message
  let sending = false;

  // The demo failure switch only makes sense for the mock API
  if (USE_MOCK_API) testFailureRow.hidden = false;

  // ---- Message ------------------------------------------------------------------------
  // Follows the wording requested in the project brief. It deliberately contains
  // NO medical details (blood group, allergy), only the minimum family needs to know.
  // Same wording as the automatic notification (rules.js), so manual and automatic messages match.
  function buildMessage() {
    return incident ? Rules.buildFamilyMessage(incident, incident.ambulance_id) : "";
  }

  function refreshMessage() {
    if (!messageEdited) messageBox.value = buildMessage();
  }

  // ---- Loading --------------------------------------------------------------------------
  async function loadIncidentData(id, keepResults) {
    currentId = id;

    if (!id) {
      clearAlert();
      view.hidden = true;
      emptyEl.innerHTML = emptyStateHtml(
        "No incident selected",
        "Choose an incident above to notify its authorized emergency contacts.",
        "<a class=\"btn btn-primary\" href=\"index.html\">Go to dashboard</a>"
      );
      return;
    }

    emptyEl.innerHTML = "<div class=\"loading-line\"><span class=\"spinner\"></span> Loading contacts&hellip;</div>";
    view.hidden = true;
    if (!keepResults) { resultsEl.innerHTML = ""; messageEdited = false; }

    try {
      incident = await getIncident(id);
      contacts = await getEmergencyContacts(id);
      rememberIncident(id);
      clearAlert();
      emptyEl.innerHTML = "";
      view.hidden = false;
      refreshMessage();
      renderContacts();
      renderLog();
    } catch (err) {
      view.hidden = true;
      emptyEl.innerHTML = emptyStateHtml("Contacts could not be loaded", describeError(err),
        "<a class=\"btn btn-primary\" href=\"index.html\">Back to dashboard</a>");
      handleError(err, { extraHtml: BACK_LINK });
    }
  }

  // ---- Rendering -------------------------------------------------------------------------
  function renderContacts() {
    contactCountEl.textContent = contacts.length + (contacts.length === 1 ? " contact" : " contacts");

    if (contacts.length === 0) {
      contactListEl.innerHTML = "<li>" + emptyStateHtml(
        "No authorized contacts",
        incident && !incident.identity_verified
          ? "The patient's identity has not been verified yet, so no emergency contacts are available."
          : "This patient has not authorized any emergency contacts."
      ) + "</li>";
      setButtonsEnabled(false);
      return;
    }

    contactListEl.innerHTML = contacts.map(function (c) {
      return "<li class=\"contact-item\">" +
        "<input type=\"checkbox\" id=\"chk-" + escapeHtml(c.contact_id) + "\" value=\"" + escapeHtml(c.contact_id) + "\" checked>" +
        "<label class=\"contact-info\" for=\"chk-" + escapeHtml(c.contact_id) + "\">" +
          "<div class=\"contact-name\">" + escapeHtml(valueOrNA(c.name)) + "</div>" +
          "<div class=\"contact-meta\">Relationship: " + escapeHtml(valueOrNA(c.relationship)) + " &middot; Phone: " +
            "<span class=\"mono\">" + escapeHtml(valueOrNA(c.phone_masked, "XXXXXXXXXX")) + "</span></div>" +
        "</label>" +
        "<span class=\"badge status-SIMULATED\">Authorized</span>" +
      "</li>";
    }).join("");
    setButtonsEnabled(true);
  }

  function setButtonsEnabled(enabled) {
    Object.keys(CHANNELS).forEach(function (key) {
      const btn = document.getElementById(CHANNELS[key].button);
      if (btn) btn.disabled = !enabled || sending;
    });
  }

  function renderLog() {
    const list = (incident && incident.notifications ? incident.notifications : []).slice().reverse();
    if (list.length === 0) {
      logBody.innerHTML = "<tr><td colspan=\"5\" class=\"muted\">No notifications have been simulated for this incident yet.</td></tr>";
      return;
    }
    logBody.innerHTML = list.map(function (n) {
      const channel = CHANNELS[n.channel] ? CHANNELS[n.channel].label : valueOrNA(n.channel);
      return "<tr>" +
        "<td>" + escapeHtml(formatTime(n.sent_at)) + "<div class=\"small muted\">" + escapeHtml(formatDateTime(n.sent_at)) + "</div></td>" +
        "<td>" + escapeHtml(valueOrNA(n.recipient_name)) + "<div class=\"small muted\">" + escapeHtml(valueOrNA(n.recipient_relationship, "")) + "</div></td>" +
        "<td>" + escapeHtml(channel) + "</td>" +
        "<td class=\"msg-cell\">" + escapeHtml(valueOrNA(n.message, "")) + "</td>" +
        "<td>" + statusBadge(n.status) + "<div class=\"small muted\">SIMULATED &middot; " + (n.triggered_by === "AUTO" ? "AUTO" : "OPERATOR") + "</div></td>" +
      "</tr>";
    }).join("");
  }

  function addResultRow(ok, text) {
    const row = document.createElement("div");
    row.className = "sim-row " + (ok ? "ok" : "fail");
    row.innerHTML = "<span aria-hidden=\"true\">" + (ok ? "✓" : "✗") + "</span>" +
      "<span>" + escapeHtml(text) + "</span>" +
      "<span class=\"sim-time\">" + escapeHtml(formatTime(new Date().toISOString())) + "</span>";
    resultsEl.insertBefore(row, resultsEl.firstChild);
  }

  // ---- Sending (simulated) ------------------------------------------------------------------
  function selectedContactIds() {
    return Array.prototype.slice.call(contactListEl.querySelectorAll("input[type=checkbox]:checked"))
      .map(function (box) { return box.value; });
  }

  async function simulate(channelKey) {
    if (sending || !currentId) return;

    const ids = selectedContactIds();
    const message = messageBox.value.trim();

    if (contacts.length === 0) {
      showToast("There are no authorized contacts to notify.", "warning");
      return;
    }
    if (ids.length === 0) {
      showAlert("Select at least one contact to notify.", "warning");
      showToast("Select at least one contact.", "warning");
      return;
    }
    if (message === "") {
      showAlert("The message is empty. Type a message or press \"Reset message\".", "warning");
      showToast("The message is empty.", "warning");
      return;
    }

    clearAlert();
    sending = true;
    const channel = CHANNELS[channelKey];
    const button = document.getElementById(channel.button);
    setButtonsEnabled(false);
    setBusy(button, true);

    let successCount = 0;
    let failureCount = 0;

    // One request per contact, so one failure does not block the others
    for (let i = 0; i < ids.length; i++) {
      const contact = contacts.find(function (c) { return c.contact_id === ids[i]; });
      const name = contact ? contact.name : ids[i];
      try {
        await sendNotification(currentId, {
          contact_id: ids[i],
          channel: channelKey,
          message: message,
          simulate_failure: (USE_MOCK_API && testFailure.checked) ? true : undefined
        });
        successCount++;
        addResultRow(true, channel.doneText + " → " + name);
      } catch (err) {
        failureCount++;
        addResultRow(false, channel.label + " to " + name + " FAILED: " + describeError(err));
        console.error("[Member 3]", err);
      }
    }

    sending = false;
    setBusy(button, false);
    setButtonsEnabled(true);

    // Keep the automation record consistent with what the operator just did (and avoid a duplicate automatic send).
    if (successCount > 0) {
      appendAutomationLog(currentId, "Operator sent " + channel.label + " (simulated) to " + successCount + " contact" + (successCount === 1 ? "" : "s") + " on the Notifications page.", failureCount ? "warn" : "info", "OPERATOR");
      updateAutomationState(currentId, function (s) {
        s.notification = failureCount === 0 ? "SENT_SIMULATED" : "PARTIAL";
        if (!s.steps.notified) s.steps.notified = new Date().toISOString();
      });
    }

    if (failureCount === 0) {
      showToast(channel.doneText + " (" + successCount + (successCount === 1 ? " contact" : " contacts") + ").", "success");
    } else if (successCount === 0) {
      showAlert("Notification failed for all selected contacts. You can try again.", "danger");
      showToast("Notification failed. Please try again.", "danger");
    } else {
      showAlert(successCount + " sent (simulated), " + failureCount + " failed. You can retry the failed contacts.", "warning");
    }

    // Refresh the log from the API so it shows exactly what was stored
    try {
      incident = await getIncident(currentId);
      renderLog();
    } catch (err) {
      handleError(err);
    }
  }

  // ---- Events ----------------------------------------------------------------------------------
  Object.keys(CHANNELS).forEach(function (key) {
    document.getElementById(CHANNELS[key].button).addEventListener("click", function () { simulate(key); });
  });

  messageBox.addEventListener("input", function () { messageEdited = true; });

  document.getElementById("reset-message-btn").addEventListener("click", function () {
    messageEdited = false;
    refreshMessage();
  });

  // ---- Start --------------------------------------------------------------------------------------
  async function start() {
    const selector = await setupIncidentSelector(function (id) { loadIncidentData(id, false); });
    await loadIncidentData(selector.selectedId, false);
  }
  start();
})();
