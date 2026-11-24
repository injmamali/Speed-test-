(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const ui = {
    start: $('startBtn'), stop: $('stopBtn'), buttonText: $('buttonText'), speed: $('speedValue'), meter: $('meter'),
    status: $('statusText'), statusIcon: $('statusIcon'), phase: $('phaseText'), percent: $('phasePercent'), fill: $('phaseFill'),
    meterState: $('meterState'), robotMood: $('robotMood'), download: $('downloadValue'), upload: $('uploadValue'), ping: $('pingValue'),
    downloadBar: $('downloadBar'), uploadBar: $('uploadBar'), pingBar: $('pingBar'), copy: $('copyBtn'), summary: $('summaryText'),
    last: $('lastTest'), quality: $('resultQuality'), session: $('sessionId')
  };
  const TEST_BASE = 'https://speed.cloudflare.com';
  let activeController = null;
  let latestReport = null;
  let animationId = 0;

  function setProgress(percent, label) {
    const p = Math.max(0, Math.min(100, percent));
    ui.fill.style.width = `${p}%`;
    ui.percent.textContent = `${Math.round(p)}%`;
    if (label) ui.phase.textContent = label;
  }
  function setStatus(message, icon = '⌁') { ui.status.textContent = message; ui.statusIcon.textContent = icon; }
  function setSpeed(value) {
    const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
    ui.speed.textContent = safe.toFixed(1);
    const degrees = Math.min(safe / 200, 1) * 360;
    ui.meter.style.setProperty('--progress', `${degrees}deg`);
  }
  function animateSpeed(target, duration = 850) {
    cancelAnimationFrame(animationId);
    const from = Number(ui.speed.textContent) || 0;
    const start = performance.now();
    return new Promise(resolve => {
      const tick = now => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        setSpeed(from + (target - from) * eased);
        if (t < 1) animationId = requestAnimationFrame(tick); else resolve();
      };
      animationId = requestAnimationFrame(tick);
    });
  }
  function setMetric(bar, value, max) { bar.style.width = `${Math.max(2, Math.min(100, value / max * 100))}%`; }
  function formatMbps(value) { return value >= 100 ? value.toFixed(0) : value.toFixed(1); }
  function checkResponse(response) { if (!response.ok) throw new Error(`Test server returned HTTP ${response.status}`); return response; }
  async function timedFetch(url, options, signal) {
    const response = await fetch(url, { ...options, signal, cache: 'no-store' });
    return checkResponse(response);
  }
  async function measurePing(signal) {
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      await timedFetch(`${TEST_BASE}/__down?bytes=0&cache=${Date.now()}-${i}`, { method: 'GET' }, signal);
      samples.push(performance.now() - start);
      setProgress(4 + (i + 1) * 2, 'Measuring latency');
    }
    samples.sort((a, b) => a - b);
    return Math.round(samples[Math.floor(samples.length / 2)]);
  }
  async function measureDownload(signal) {
    // Three simultaneous 4 MB transfers provide a more stable throughput estimate.
    const sizes = [4_000_000, 4_000_000, 4_000_000];
    let received = 0;
    const start = performance.now();
    let lastPaint = 0;
    await Promise.all(sizes.map(async (bytes, index) => {
      const response = await timedFetch(`${TEST_BASE}/__down?bytes=${bytes}&cache=${Date.now()}-${index}`, { method: 'GET' }, signal);
      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          const now = performance.now();
          if (now - lastPaint > 120) {
            const elapsed = Math.max((now - start) / 1000, .1);
            const current = received * 8 / elapsed / 1_000_000;
            setSpeed(current);
            setProgress(18 + Math.min(35, received / 12_000_000 * 35), 'Measuring download throughput');
            lastPaint = now;
          }
        }
      } else {
        const data = await response.arrayBuffer();
        received += data.byteLength;
      }
    }));
    const seconds = (performance.now() - start) / 1000;
    if (!received || seconds <= 0) throw new Error('Download measurement returned no data.');
    return received * 8 / seconds / 1_000_000;
  }
  async function measureUpload(signal) {
    const bytes = 2_000_000;
    const payload = new Uint8Array(bytes);
    // Fill with varying bytes so the request is not trivially compressible.
    if (globalThis.crypto?.getRandomValues) {
      for (let offset = 0; offset < payload.length; offset += 65_536) {
        crypto.getRandomValues(payload.subarray(offset, Math.min(offset + 65_536, payload.length)));
      }
    } else {
      for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + 17) % 251;
    }
    const start = performance.now();
    const response = await timedFetch(`${TEST_BASE}/__up?cache=${Date.now()}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: payload
    }, signal);
    await response.arrayBuffer().catch(() => new ArrayBuffer(0));
    const seconds = (performance.now() - start) / 1000;
    if (seconds <= 0) throw new Error('Upload measurement returned an invalid duration.');
    return bytes * 8 / seconds / 1_000_000;
  }
  function qualityFor(download, upload, ping) {
    if (download >= 100 && upload >= 20 && ping <= 30) return 'EXCELLENT';
    if (download >= 25 && upload >= 5 && ping <= 60) return 'GOOD';
    if (download >= 5 && ping <= 100) return 'FAIR';
    return 'LIMITED';
  }
  function getConnectionInfo() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    $('networkType').textContent = navigator.onLine ? (c?.type || 'Online') : 'Offline';
    $('effectiveType').textContent = c?.effectiveType?.toUpperCase() || 'Not available';
    $('downlinkEstimate').textContent = c?.downlink ? `${c.downlink} Mbps` : 'Not available';
    $('saveData').textContent = c?.saveData ? 'Enabled' : (c ? 'Disabled' : 'Not available');
    $('connectionLabel').textContent = navigator.onLine ? 'SYSTEM ONLINE' : 'NO NETWORK';
  }
  function resetResults() {
    ui.download.textContent = '—'; ui.upload.textContent = '—'; ui.ping.textContent = '—';
    [ui.downloadBar, ui.uploadBar, ui.pingBar].forEach(el => el.style.width = '0%');
    ui.copy.disabled = true; latestReport = null;
    ui.summary.textContent = 'Your latest scan report will appear here.';
    ui.quality.textContent = 'AWAITING DATA';
  }
  function setRunning(running) {
    ui.start.disabled = running; ui.stop.disabled = !running;
    ui.buttonText.textContent = running ? 'SCANNING NETWORK…' : (latestReport ? 'RUN TEST AGAIN' : 'INITIATE SPEED TEST');
    ui.meterState.textContent = running ? 'SCANNING' : (latestReport ? 'COMPLETE' : 'STANDBY');
    ui.robotMood.textContent = running ? 'ANALYSING NETWORK' : (latestReport ? 'SCAN COMPLETE' : 'READY TO SCAN');
    ui.session.textContent = running ? 'SESSION // ACTIVE' : (latestReport ? 'SESSION // SAVED' : 'SESSION // READY');
  }
  async function runTest() {
    if (!navigator.onLine) { setStatus('No internet connection detected. Connect to a network and try again.', '!'); return; }
    activeController = new AbortController();
    const { signal } = activeController;
    resetResults(); setRunning(true); setProgress(0, 'Initialising diagnostics'); setSpeed(0);
    const startedAt = new Date();
    try {
      setStatus('Connecting to the test server…');
      // Guard against a stalled test without relying on a browser-specific timeout option.
      const timeout = setTimeout(() => activeController?.abort(new DOMException('Test timed out after 45 seconds.', 'TimeoutError')), 45_000);
      try {
        setProgress(3, 'Connecting to test server');
        const ping = await measurePing(signal);
        ui.ping.textContent = String(ping); setMetric(ui.pingBar, ping, 180);
        setStatus(`Latency measured at ${ping} ms. Starting download test…`, '✓');
        setProgress(16, 'Preparing download test');
        const download = await measureDownload(signal);
        ui.download.textContent = formatMbps(download); setMetric(ui.downloadBar, download, 200);
        await animateSpeed(download, 500);
        setStatus('Download complete. Measuring upload capacity…', '↓');
        setProgress(57, 'Preparing upload test');
        const upload = await measureUpload(signal);
        ui.upload.textContent = formatMbps(upload); setMetric(ui.uploadBar, upload, 100);
        await animateSpeed(upload, 500);
        await animateSpeed(download, 650);
        setProgress(100, 'Diagnostics complete');
        const quality = qualityFor(download, upload, ping);
        latestReport = { download, upload, ping, quality, time: startedAt.toLocaleString(), server: 'Cloudflare Speed Test' };
        ui.summary.textContent = `Your connection measured ${formatMbps(download)} Mbps download, ${formatMbps(upload)} Mbps upload and ${ping} ms latency. Overall rating: ${quality.toLowerCase()}.`;
        ui.last.textContent = `LAST SCAN // ${startedAt.toLocaleTimeString()}`;
        ui.quality.textContent = quality;
        ui.copy.disabled = false;
        setStatus('All measurements completed successfully. Your report is ready.', '✓');
      } finally { clearTimeout(timeout); }
    } catch (error) {
      const aborted = signal.aborted;
      const reason = signal.reason;
      if (aborted && reason?.name === 'AbortError') {
        setStatus('Scan stopped. Start a new test whenever you are ready.', 'Ⅱ');
      } else if (aborted && reason?.name === 'TimeoutError') {
        setStatus('The test took too long. Check your connection and try again.', '!');
      } else {
        console.error('Speed test error:', error);
        setStatus('Could not complete the test. The server may be blocked or your connection may be unstable. Try again.', '!');
      }
      ui.meterState.textContent = 'INTERRUPTED'; ui.robotMood.textContent = 'AWAITING RETRY';
      ui.session.textContent = 'SESSION // INCOMPLETE';
      setProgress(0, 'Scan interrupted');
    } finally {
      activeController = null; setRunning(false);
      if (!latestReport && ui.meterState.textContent !== 'INTERRUPTED') ui.meterState.textContent = 'STANDBY';
    }
  }
  ui.start.addEventListener('click', runTest);
  ui.stop.addEventListener('click', () => { if (activeController) activeController.abort(new DOMException('Stopped by user.', 'AbortError')); });
  ui.copy.addEventListener('click', async () => {
    if (!latestReport) return;
    const report = `NEON//SPEED — SPEED TEST REPORT\nDate: ${latestReport.time}\nServer: ${latestReport.server}\nDownload: ${formatMbps(latestReport.download)} Mbps\nUpload: ${formatMbps(latestReport.upload)} Mbps\nPing: ${latestReport.ping} ms\nRating: ${latestReport.quality}\n\nMeasurements are estimates and depend on network conditions.`;
    try {
      await navigator.clipboard.writeText(report);
      ui.copy.textContent = '✓ COPIED';
      setTimeout(() => { ui.copy.textContent = '▣ COPY REPORT'; }, 1800);
    } catch {
      const area = document.createElement('textarea'); area.value = report; area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.appendChild(area); area.select();
      const ok = document.execCommand('copy'); area.remove();
      ui.copy.textContent = ok ? '✓ COPIED' : 'COPY BLOCKED';
      setTimeout(() => { ui.copy.textContent = '▣ COPY REPORT'; }, 1800);
    }
  });
  window.addEventListener('online', getConnectionInfo);
  window.addEventListener('offline', getConnectionInfo);
  if (navigator.connection?.addEventListener) navigator.connection.addEventListener('change', getConnectionInfo);
  getConnectionInfo();
})();
