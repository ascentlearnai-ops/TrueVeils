/* global TRUVEIL_CANDIDATE_PREVIEW */
const { samples, MAX_LENGTH } = require("./demo-samples");
const engine = TRUVEIL_CANDIDATE_PREVIEW ? null : require("./demo-model");
const TYPE_DELAY = 25;
const SAMPLE_HOLD_DELAY = 2200;
const SAMPLE_SWITCH_DELAY = 220;
const SCORE_TWEEN_DURATION = 360;

const panel = document.querySelector("#panel-interview");
if (panel) {
  const find = (selector) => panel.querySelector(selector);
  const transcript = find("[data-transcript]");
  const input = find("[data-answer-input]");
  const sampleControls = find("[data-sample-controls]");
  const modeButtons = [...panel.querySelectorAll("[data-demo-mode]")];
  const scenario = find("[data-demo-scenario]");
  const playButton = find("[data-demo-play]");
  const replayButton = find("[data-demo-replay]");
  const status = find("[data-demo-status]");
  const score = find("[data-signal-score]");
  const meter = find("[data-signal-meter]");
  const signalLabel = find("[data-signal-label]");
  const evidence = find("[data-signal-evidence]");
  const live = find("[data-demo-live]");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let mode = "sample";
  let cursor = 0;
  let timer;
  let debounce;
  let paused = false;
  let visible = false;
  let composing = false;
  let nextAnalysis = 0;
  let switching = false;
  let scoreFrame;
  let displayedScore = null;
  input.maxLength = MAX_LENGTH;
  const version = find("[data-model-version]");
  if (!TRUVEIL_CANDIDATE_PREVIEW && version)
    version.textContent = engine.MODEL_VERSION.replace(
      "truveil-risk-",
      "Risk engine ",
    );

  function renderScore(target) {
    if (!score) return;
    cancelAnimationFrame(scoreFrame);
    const nextScore = Number.isFinite(target) ? target : null;
    if (nextScore === null) {
      displayedScore = null;
      score.textContent = "--";
      score.classList.remove("is-updating");
      return;
    }
    if (reduced.matches) {
      displayedScore = nextScore;
      score.textContent = nextScore;
      score.classList.remove("is-updating");
      return;
    }
    const startScore = displayedScore ?? 0;
    if (startScore === nextScore) {
      score.textContent = nextScore;
      return;
    }
    const startedAt = performance.now();
    score.classList.add("is-updating");
    const step = (now) => {
      const progress = Math.min((now - startedAt) / SCORE_TWEEN_DURATION, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      displayedScore = Math.round(
        startScore + (nextScore - startScore) * eased,
      );
      score.textContent = displayedScore;
      if (progress < 1) scoreFrame = requestAnimationFrame(step);
      else score.classList.remove("is-updating");
    };
    scoreFrame = requestAnimationFrame(step);
  }

  function paint(announce = false) {
    const text =
      mode === "sample"
        ? samples[scenario.value].text.slice(0, cursor)
        : input.value;
    if (TRUVEIL_CANDIDATE_PREVIEW) {
      const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
      find("[data-word-count]").textContent = `${words} words`;
      find("[data-candidate-words]").textContent = words;
      find("[data-candidate-state]").textContent = !words
        ? "Ready for your answer"
        : mode === "custom"
          ? "Your words, on this device"
          : cursor < samples[scenario.value].text.length
            ? "A transcript taking shape"
            : "The complete answer, in context";
      if (announce)
        live.textContent = `${words} words in this transcript preview. Nothing is sent or saved.`;
    } else {
      const sampleEvent =
        mode === "sample" && cursor >= samples[scenario.value].eventAt;
      const result = engine.assess(text, sampleEvent);
      renderScore(result.scorable ? result.score : null);
      meter.value = result.score || 0;
      meter.setAttribute(
        "aria-valuetext",
        result.scorable
          ? `${result.score} out of 100, advisory signal strength`
          : "Insufficient evidence",
      );
      signalLabel.textContent = result.scorable
        ? result.score >= 80
          ? "Strong assistance signals"
          : result.score >= 60
            ? "Elevated assistance signals"
            : "Limited assistance signals"
        : "Not enough text yet";
      panel.dataset.signal =
        result.scorable && result.score >= 60 ? "elevated" : "low";
      evidence.replaceChildren();
      const reasons = result.scorable
        ? [
            ...result.aiSignals.slice(0, 2),
            ...(result.counterSignal
              ? [`Counter-evidence: ${result.counterSignal}`]
              : []),
          ]
        : ["At least 18 words and two sentences, or 24 words."];
      if (!reasons.length)
        reasons.push(
          "No strong transcript pattern found. This does not prove human authorship.",
        );
      for (const reason of reasons) {
        const item = document.createElement("li");
        item.textContent = reason;
        evidence.append(item);
      }
      find("[data-sample-event]").hidden = !sampleEvent;
      find("[data-event-source]").textContent =
        mode === "sample"
          ? sampleEvent
            ? "Simulated restricted-tool event + sample text"
            : "Sample transcript only"
          : "Your text only. No app or browser monitoring.";
      find("[data-word-count]").textContent =
        `${result.features.wordCount} words`;
      const reviewQuote = document.querySelector("[data-review-quote]");
      if (reviewQuote) {
        reviewQuote.textContent = text || "Your answer will appear here.";
        document.querySelector("[data-review-summary]").textContent =
          result.scorable
            ? `${result.score}/100 advisory AI-assistance signal. ${sampleEvent ? "This sample includes a simulated restricted-tool event. " : "Text-only analysis; no activity evidence. "}Patterns can be wrong. This is not a probability of AI authorship or a hiring recommendation.`
            : "Insufficient evidence. No authorship conclusion can be drawn from a short answer.";
        document.querySelector("[data-review-source]").textContent =
          mode === "sample" ? "Sample review" : "Local text preview";
      }
      if (announce)
        live.textContent = result.scorable
          ? `${signalLabel.textContent}: ${result.score} out of 100. Advisory, not an authorship probability.`
          : signalLabel.textContent;
    }
  }

  function canAnimate() {
    return (
      mode === "sample" &&
      !paused &&
      visible &&
      !panel.hidden &&
      !document.hidden &&
      !reduced.matches
    );
  }

  function canType() {
    return (
      canAnimate() &&
      !switching &&
      cursor < samples[scenario.value].text.length
    );
  }

  function sync() {
    clearTimeout(timer);
    const complete = cursor >= samples[scenario.value].text.length;
    const playing = canType();
    const active = canAnimate();
    playButton.disabled = reduced.matches;
    panel.classList.toggle("is-typing", playing);
    playButton.dataset.playing = String(active);
    playButton.setAttribute(
      "aria-label",
      paused ? "Play sample answer" : "Pause sample answer",
    );
    playButton.title = reduced.matches
      ? "Sample shown without animation"
      : playButton.getAttribute("aria-label");
    status.textContent =
      mode === "custom"
        ? TRUVEIL_CANDIDATE_PREVIEW
          ? "Local preview"
          : "Local analysis"
        : switching
          ? "Loading next sample"
          : complete
            ? paused
              ? "Sample paused"
              : active
                ? "Next sample soon"
                : "Sample complete"
          : paused
            ? "Sample paused"
            : playing
              ? "Transcribing sample"
              : "Sample ready";
    if (!active) return;
    if (switching) timer = setTimeout(advanceSample, SAMPLE_SWITCH_DELAY);
    else if (complete) timer = setTimeout(beginNextSample, SAMPLE_HOLD_DELAY);
    else if (playing) timer = setTimeout(tick, TYPE_DELAY);
  }

  function tick() {
    if (!canType()) return sync();
    const text = samples[scenario.value].text;
    cursor = Math.min(cursor + 1, text.length);
    transcript.textContent = text.slice(0, cursor);
    if (cursor >= nextAnalysis || cursor === text.length) {
      paint();
      nextAnalysis = cursor + 24;
    }
    sync();
  }

  function beginNextSample() {
    if (!canAnimate()) return sync();
    switching = true;
    panel.classList.add("is-switching");
    sync();
  }

  function advanceSample() {
    if (!canAnimate()) {
      switching = false;
      panel.classList.remove("is-switching");
      return sync();
    }
    const options = [...scenario.options];
    const currentIndex = options.findIndex(
      (option) => option.value === scenario.value,
    );
    const nextOption = options[(currentIndex + 1) % options.length];
    options.forEach((option) =>
      option.toggleAttribute("selected", option === nextOption),
    );
    scenario.value = nextOption.value;
    cursor = 0;
    nextAnalysis = 0;
    switching = false;
    paused = false;
    transcript.textContent = "";
    paint();
    panel.classList.remove("is-switching");
    sync();
  }

  function restart() {
    switching = false;
    panel.classList.remove("is-switching");
    cursor = reduced.matches ? samples[scenario.value].text.length : 0;
    nextAnalysis = 0;
    paused = false;
    transcript.textContent = samples[scenario.value].text.slice(0, cursor);
    paint();
    sync();
  }

  modeButtons.forEach((button) =>
    button.addEventListener("click", () => {
      mode = button.dataset.demoMode;
      clearTimeout(debounce);
      modeButtons.forEach((item) =>
        item.setAttribute("aria-pressed", String(item === button)),
      );
      sampleControls.hidden = mode !== "sample";
      find("[data-sample-answer]").hidden = mode !== "sample";
      find("[data-custom-answer]").hidden = mode !== "custom";
      find("[data-speaker-name]").textContent =
        mode === "sample" ? "JORDAN / CANDIDATE" : "YOUR ANSWER";
      find(".tour-context").textContent =
        mode === "sample"
          ? "Jordan Lee / Backend engineer / Sample interview"
          : TRUVEIL_CANDIDATE_PREVIEW
            ? "Your answer / Private practice preview"
            : "Local text preview / English-language transcript signals";
      const reviewContext = document.querySelector(
        "#panel-review .tour-context",
      );
      if (reviewContext)
        reviewContext.textContent =
          mode === "sample"
            ? "Sample review / Jordan Lee"
            : "Your text / Local preview";
      if (mode === "sample") restart();
      else {
        switching = false;
        panel.classList.remove("is-switching");
        paint();
        sync();
        input.focus();
      }
    }),
  );
  scenario.addEventListener("change", restart);
  playButton.addEventListener("click", () => {
    paused = !paused;
    sync();
  });
  replayButton.addEventListener("click", restart);
  find("[data-demo-complete]")?.addEventListener("click", () => {
    switching = false;
    paused = true;
    panel.classList.remove("is-switching");
    cursor = samples[scenario.value].text.length;
    transcript.textContent = samples[scenario.value].text;
    paint(true);
    sync();
  });
  find("[data-demo-clear]")?.addEventListener("click", () => {
    clearTimeout(debounce);
    input.value = "";
    paint(true);
    input.focus();
  });
  input.addEventListener("compositionstart", () => {
    composing = true;
    clearTimeout(debounce);
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    paint(true);
  });
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    if (!composing) debounce = setTimeout(() => paint(true), 300);
  });
  new MutationObserver(sync).observe(panel, {
    attributes: true,
    attributeFilter: ["hidden"],
  });
  document.addEventListener("visibilitychange", sync);
  reduced.addEventListener("change", () => {
    if (reduced.matches) {
      cursor = samples[scenario.value].text.length;
      transcript.textContent = samples[scenario.value].text;
      paint();
    }
    sync();
  });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
        sync();
      },
      { threshold: 0.25 },
    ).observe(find(".demo-transcript"));
  } else visible = true;
  restart();
}
