(function () {
  var errors = [];
  var startedAt = new Date().toISOString();

  function text(value) {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  }

  function report(kind, value) {
    errors.push({ at: new Date().toISOString(), kind: kind, message: text(value) });
    if (errors.length > 20) errors.shift();
  }

  function buildReport(status) {
    return [
      "QCL Activity Diagnostics",
      "Status: " + status,
      "Started: " + startedAt,
      "Checked: " + new Date().toISOString(),
      "URL: " + location.href,
      "Online: " + navigator.onLine,
      "Referrer: " + (document.referrer || "none"),
      "Browser: " + navigator.userAgent,
      "Errors:",
      errors.length ? errors.map(function (e) {
        return "[" + e.at + "] " + e.kind + ": " + e.message;
      }).join("\n") : "No JavaScript error was reported. A file may have been blocked or failed to load."
    ].join("\n");
  }

  function showFailure(status, message) {
    var messageNode = document.getElementById("qcl-boot-message");
    var detailsNode = document.getElementById("qcl-boot-details");
    var actionsNode = document.getElementById("qcl-boot-actions");
    var progressNode = document.getElementById("qcl-boot-progress");
    if (!messageNode) return;
    messageNode.textContent = message;
    messageNode.style.color = "#ffb4b4";
    if (progressNode) {
      progressNode.style.width = "100%";
      progressNode.style.background = "#ef4444";
    }
    if (detailsNode) {
      detailsNode.style.display = "block";
      detailsNode.textContent = buildReport(status);
    }
    if (actionsNode) actionsNode.style.display = "flex";
  }

  window.addEventListener("error", function (event) {
    var target = event.target;
    if (target && target !== window && (target.src || target.href)) {
      report("resource", "Failed to load " + (target.src || target.href));
      showFailure("RESOURCE_LOAD_FAILED", "A required Activity file was blocked or could not be downloaded.");
      return;
    }
    report("javascript", event.error || event.message || "Unknown script error");
  }, true);

  window.addEventListener("unhandledrejection", function (event) {
    report("promise", event.reason || "Unhandled promise rejection");
  });

  window.addEventListener("offline", function () {
    report("network", "Device went offline");
    showFailure("OFFLINE", "This device lost its internet connection.");
  });

  window.QCL_DIAGNOSTICS = {
    report: report,
    getReport: function () { return buildReport("RUNTIME_ERROR"); },
    copy: function () {
      var reportText = buildReport("BOOT_FAILED");
      if (navigator.clipboard) navigator.clipboard.writeText(reportText);
    },
    markReady: function () {
      document.documentElement.setAttribute("data-qcl-ready", "true");
    }
  };

  var reloadButton = document.getElementById("qcl-boot-reload");
  var copyButton = document.getElementById("qcl-boot-copy");
  if (reloadButton) reloadButton.addEventListener("click", function () { location.reload(); });
  if (copyButton) copyButton.addEventListener("click", function () { window.QCL_DIAGNOSTICS.copy(); });

  window.setTimeout(function () {
    if (document.documentElement.getAttribute("data-qcl-ready") !== "true") {
      report("timeout", "React did not report ready within 12 seconds");
      showFailure("BOOT_TIMEOUT", "The Activity did not finish starting. The report below can help identify why.");
    }
  }, 12000);
})();

/* Load the owner/admin broadcast controls outside the compiled QTCG bundle. */
(function loadQspnDraftTools() {
  if (!document.querySelector('link[href*="qspn-draft-tools.css"]')) {
    var style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = './qspn-draft-tools.css?v=director-visible-3';
    style.dataset.qspnDraftTools = 'true';
    document.head.appendChild(style);
  }
  if (!document.querySelector('script[src*="qspn-draft-tools.js"]')) {
    var script = document.createElement('script');
    script.src = './qspn-draft-tools.js?v=director-visible-3';
    script.dataset.qspnDraftTools = 'true';
    document.body.appendChild(script);
  }
  if (!document.querySelector('link[href*="qspn-test-mode.css"]')) {
    var testStyle = document.createElement('link');
    testStyle.rel = 'stylesheet';
    testStyle.href = './qspn-test-mode.css?v=test-lab-1';
    document.head.appendChild(testStyle);
  }
  if (!document.querySelector('script[src*="qspn-test-mode.js"]')) {
    var testScript = document.createElement('script');
    testScript.src = './qspn-test-mode.js?v=test-lab-1';
    document.body.appendChild(testScript);
  }
})();