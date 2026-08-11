const startBtn = document.getElementById("startBtn");
const speedText = document.getElementById("speed");
const downloadText = document.getElementById("download");
const uploadText = document.getElementById("upload");
const pingText = document.getElementById("ping");
const statusText = document.getElementById("status");
const gauge = document.querySelector(".gauge");

let animationFrame;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Smooth number animation
function animateNumber(element, from, to, duration = 1200) {
  return new Promise(resolve => {

    const start = performance.now();

    function animate(currentTime) {

      const progress = Math.min(
        (currentTime - start) / duration,
        1
      );

      // Smooth ease-out
      const ease = 1 - Math.pow(1 - progress, 4);

      const value = from + (to - from) * ease;

      element.textContent = value.toFixed(1);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      } else {
        resolve();
      }
    }

    cancelAnimationFrame(animationFrame);
    requestAnimationFrame(animate);
  });
}


// Smooth gauge animation
function animateGauge(from, to, duration = 1200) {

  return new Promise(resolve => {

    const start = performance.now();

    function animate(currentTime) {

      const progress = Math.min(
        (currentTime - start) / duration,
        1
      );

      const ease = 1 - Math.pow(1 - progress, 4);

      const value = from + (to - from) * ease;

      const maxSpeed = 200;
      const percent = Math.min(value / maxSpeed, 1);
      const degree = percent * 360;

      gauge.style.background = `
        conic-gradient(
          #00e5ff ${degree}deg,
          #1b263d ${degree}deg
        )
      `;

      speedText.textContent = value.toFixed(1);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      } else {
        resolve();
      }
    }

    cancelAnimationFrame(animationFrame);
    requestAnimationFrame(animate);
  });
}


// Smooth test phase
async function runSpeedPhase(min, max, duration) {

  const target =
    Math.random() * (max - min) + min;

  const startSpeed = Number(speedText.textContent) || 0;

  await animateGauge(
    startSpeed,
    target,
    duration
  );

  return target;
}


async function fakeSpeedTest() {

  startBtn.disabled = true;
  startBtn.textContent = "TESTING...";

  downloadText.textContent = "--";
  uploadText.textContent = "--";
  pingText.textContent = "--";

  speedText.textContent = "0";

  gauge.style.background = `
    conic-gradient(
      #00e5ff 0deg,
      #1b263d 0deg
    )
  `;


  // ----------------
  // PING
  // ----------------

  statusText.textContent = "Checking ping...";

  await sleep(1200);

  const ping =
    Math.floor(Math.random() * 25) + 8;

  pingText.textContent = ping;


  // ----------------
  // DOWNLOAD
  // ----------------

  statusText.textContent =
    "Testing download speed...";

  const download =
    await runSpeedPhase(
      60,
      180,
      2800
    );

  await animateNumber(
    downloadText,
    0,
    download,
    800
  );


  // ----------------
  // UPLOAD
  // ----------------

  statusText.textContent =
    "Testing upload speed...";

  const upload =
    await runSpeedPhase(
      20,
      90,
      2200
    );

  await animateNumber(
    uploadText,
    0,
    upload,
    800
  );


  // ----------------
  // COMPLETE
  // ----------------

  statusText.textContent =
    "Speed test completed ✓";

  startBtn.disabled = false;
  startBtn.textContent = "TEST AGAIN";
}


startBtn.addEventListener(
  "click",
  fakeSpeedTest
);