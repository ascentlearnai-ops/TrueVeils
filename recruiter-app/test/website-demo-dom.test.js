const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");
const { samples } = require("../src/website/demo-samples");
const root = path.join(__dirname, "../../landing");
const candidateRoot = path.resolve(root, "../../Truveil-Client");
const candidateIntegration = {
  skip:
    !existsSync(path.join(candidateRoot, "index.html")) &&
    "Cross-repository preview integration requires the sibling Truveil-Client checkout",
};

function setup({
  reduced = false,
  fine = true,
  shared = false,
  candidate = false,
  motion = false,
  saveData = false,
  seekDelay = 0,
  offscreen = false,
  file = "index.html",
} = {}) {
  const htmlRoot = candidate
    ? path.resolve(root, "../../Truveil-Client")
    : root;
  const { window, document } = parseHTML(
    readFileSync(path.join(htmlRoot, file), "utf8"),
  );
  const timers = new Map();
  const observers = [];
  const mutations = [];
  const media = new Map();
  let now = 0;
  let sequence = 0;
  const later = (callback, delay = 0) => {
    timers.set(++sequence, { callback, when: now + delay });
    return sequence;
  };
  const cancel = (id) => timers.delete(id);
  const matchMedia = (query) => {
    if (!media.has(query))
      media.set(query, {
        matches: query.includes("reduced") ? reduced : fine,
        listeners: [],
        addEventListener(name, callback) {
          this.listeners.push(callback);
        },
      });
    return media.get(query);
  };
  class IntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      observers.push(this);
    }
    observe(target) {
      this.target = target;
      this.targets.add(target);
    }
    unobserve(target) {
      this.targets.delete(target);
    }
  }
  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      mutations.push(this);
    }
    observe(target) {
      this.target = target;
    }
  }
  window.IntersectionObserver = IntersectionObserver;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({
    top: offscreen ? 1200 : 0,
    bottom: 700,
    height: 700,
  });
  Object.defineProperty(document, "hidden", { value: false, writable: true });
  Object.defineProperty(document.documentElement, "clientWidth", {
    value: 1200,
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    value: 800,
  });
  const storage = new Map();
  const context = vm.createContext({
    document,
    window,
    IntersectionObserver,
    MutationObserver,
    matchMedia,
    setTimeout: later,
    clearTimeout: cancel,
    requestAnimationFrame: (fn) => later(() => fn(now), 16),
    cancelAnimationFrame: cancel,
    performance: { now: () => now },
    URLSearchParams,
    URL,
    innerHeight: 800,
    location: { search: "", hash: "", origin: "https://truveil.test" },
    navigator: { connection: { saveData } },
    localStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
  });
  if (shared)
    vm.runInContext(readFileSync(path.join(htmlRoot, "site.js"), "utf8"), context);
  vm.runInContext(
    readFileSync(path.join(htmlRoot, "interview-demo.js"), "utf8"),
    context,
  );
  const query = (selector) => document.querySelector(selector);
  const dispatch = (element, type, properties = {}) => {
    const event = new window.Event(type, { bubbles: true });
    Object.assign(event, properties);
    element.dispatchEvent(event);
  };
  if (motion) {
    for (const video of document.querySelectorAll("video")) {
      let time = 0;
      video.paused = true;
      video.duration = 6;
      video.readyState = video.classList.contains("cinema-look") ? 0 : 4;
      video.seeking = false;
      video.seekCount = 0;
      video.presentedTime = 0;
      video.play = () => {
        video.paused = false;
        dispatch(video, "play");
        return Promise.resolve();
      };
      video.pause = () => {
        video.paused = true;
        dispatch(video, "pause");
      };
      video.load = () => {
        video.readyState = 4;
        dispatch(video, "loadeddata");
      };
      Object.defineProperty(video, "currentTime", {
        get: () => time,
        set: (value) => {
          assert.equal(video.seeking, false, "Never restart an in-flight seek");
          time = value;
          video.seekCount += 1;
          video.seeking = true;
          const complete = () => {
            video.seeking = false;
            video.presentedTime = value;
            dispatch(video, "seeked");
          };
          if (seekDelay) later(complete, seekDelay);
          else complete();
        },
      });
    }
    vm.runInContext(
      readFileSync(path.join(root, "motion.js"), "utf8"),
      context,
    );
  }
  return {
    query,
    document,
    storage,
    timers,
    intersect(selector, isIntersecting = true) {
      const target = query(selector);
      observers
        .filter((item) => item.targets.has(target))
        .forEach((item) =>
          item.callback([
            {
              target,
              isIntersecting,
              intersectionRatio: isIntersecting ? 1 : 0,
            },
          ]),
        );
    },
    click: (selector) => dispatch(query(selector), "click"),
    input(value) {
      query("#demo-answer").value = value;
      dispatch(query("#demo-answer"), "input");
    },
    visible(isIntersecting = true) {
      observers
        .filter((item) => item.target?.classList.contains("demo-transcript"))
        .forEach((item) =>
          item.callback([
            { isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 },
          ]),
        );
    },
    heroVisible(isIntersecting = true) {
      observers
        .filter((item) => item.target?.classList.contains("cinema-hero"))
        .forEach((item) => item.callback([{ isIntersecting }]));
    },
    hidePanel(hidden) {
      query("#panel-interview").hidden = hidden;
      mutations.forEach((item) => item.callback([]));
    },
    media(queryPart, matches) {
      for (const [key, value] of media)
        if (key.includes(queryPart)) {
          value.matches = matches;
          value.listeners.forEach((fn) => fn({ matches }));
        }
    },
    pointer(selector = ".demo-answer", x = 200, y = 200) {
      dispatch(query(selector), "pointermove", {
        pointerType: "mouse",
        clientX: x,
        clientY: y,
      });
    },
    dispatch,
    advance(milliseconds) {
      const end = now + milliseconds;
      let count = 0;
      while (timers.size) {
        const next = [...timers.entries()].sort(
          (a, b) => a[1].when - b[1].when,
        )[0];
        if (next[1].when > end) break;
        assert.ok(count++ < 10000, "timer loop stays bounded");
        now = next[1].when;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = end;
    },
  };
}

test("sample types only in view, pauses, resumes and replays", () => {
  const page = setup();
  page.advance(500);
  assert.equal(page.query("[data-transcript]").textContent, "");
  page.visible();
  page.advance(500);
  const partial = page.query("[data-transcript]").textContent;
  assert.ok(partial.length > 0 && partial.length < 50);
  page.click("[data-demo-play]");
  page.advance(500);
  assert.equal(page.query("[data-transcript]").textContent, partial);
  page.click("[data-demo-play]");
  page.advance(samples.assisted.text.length * 25 + 500);
  assert.equal(page.query("[data-demo-status]").textContent, "Next sample soon");
  assert.equal(page.query("[data-signal-score]").textContent, "84");
  page.click("[data-demo-play]");
  page.advance(2500);
  assert.equal(page.query("[data-demo-scenario]").value, "assisted");
  assert.equal(page.query("[data-demo-status]").textContent, "Sample paused");
  page.click("[data-demo-play]");
  page.advance(2500);
  assert.equal(page.query("[data-demo-scenario]").value, "grounded");
  assert.ok(page.query("[data-transcript]").textContent.length > 0);
  page.click("[data-demo-replay]");
  assert.equal(page.query("[data-transcript]").textContent, "");
});

for (const candidate of [false, true]) {
  test(`${candidate ? "candidate" : "recruiter"} standalone demo works without login or backend`, candidate ? candidateIntegration : {}, () => {
    const page = setup({ candidate, shared: true, file: "demo.html" });
    page.visible();
    page.click("[data-demo-complete]");
    page.advance(10000);
    const expected = candidate ? samples.grounded : samples.assisted;
    assert.equal(page.query("[data-transcript]").textContent, expected.text);
    assert.equal(page.query("[data-demo-status]").textContent, "Sample paused");
    assert.equal(page.query("form"), null);
    assert.equal(page.query("video"), null);
    assert.equal(page.query(".cinema-hero"), null);
    assert.equal(page.document.querySelectorAll("h1").length, 1);
    assert.equal(page.storage.size, 0);
    assert.equal(page.timers.size, 0, "Completed sample remains paused");
    if (!candidate) assert.equal(page.query("[data-signal-score]").textContent, "84");
    else assert.equal(page.query("[data-signal-score]"), null);
    page.click('[data-demo-mode="custom"]');
    page.input(samples.grounded.text);
    page.advance(700);
    page.click("[data-demo-clear]");
    page.advance(700);
    assert.equal(page.query("#demo-answer").value, "");
    if (candidate) assert.equal(page.query("[data-candidate-words]").textContent, "0");
    else {
      assert.equal(page.query("[data-signal-score]").textContent, "--");
      assert.equal(page.query("[data-sample-event]").hidden, true);
      assert.equal(page.query("[data-review-quote]").textContent, "Your answer will appear here.");
      page.click('[data-tour="review"]');
      assert.equal(page.query("#panel-review").hidden, false);
    }
  });

  test(`${candidate ? "candidate" : "recruiter"} demo page is current and reachable from main entrypoints`, candidate ? candidateIntegration : {}, () => {
    const siteRoot = candidate ? candidateRoot : root;
    const read = name => readFileSync(path.join(siteRoot, name), "utf8");
    const { buildDemoPage } = require("../scripts/demo-page");
    assert.equal(read("demo.html").replace(/\r\n/g, "\n"), buildDemoPage(read("index.html")));
    for (const name of ["index.html", "login.html", "guide.html"]) {
      const { document } = parseHTML(read(name));
      assert.ok(document.querySelector('main a[href="demo.html"]'), `${name} links to demo`);
    }
    const { document } = parseHTML(read("demo.html"));
    for (const link of document.querySelectorAll('a[href^="#"]'))
      assert.ok(document.getElementById(link.getAttribute("href").slice(1)), "Fragment target exists");
    assert.ok(document.querySelector(`a[href="https://truveil-${candidate ? "recruiter" : "secure"}.vercel.app/demo.html"]`));
  });
}
test("hidden tabs and offscreen panels stop the typewriter", () => {
  const page = setup();
  page.visible();
  page.advance(400);
  const before = page.query("[data-transcript]").textContent;
  page.hidePanel(true);
  page.advance(400);
  assert.equal(page.query("[data-transcript]").textContent, before);
  page.hidePanel(false);
  page.advance(100);
  assert.ok(page.query("[data-transcript]").textContent.length > before.length);
  page.visible(false);
  const after = page.query("[data-transcript]").textContent;
  page.advance(400);
  assert.equal(page.query("[data-transcript]").textContent, after);
});
test("custom answer updates, clears and never inherits a sample event", () => {
  const page = setup();
  page.visible();
  page.advance(samples.assisted.text.length * 25 + 500);
  assert.equal(page.query("[data-sample-event]").hidden, false);
  page.click('[data-demo-mode="custom"]');
  page.input(
    "First, I would establish a robust incident response process. I would leverage cross-functional collaboration to align stakeholders and implement a scalable solution.",
  );
  page.advance(700);
  assert.equal(page.query("[data-sample-event]").hidden, true);
  assert.ok(Number(page.query("[data-signal-score]").textContent) <= 68);
  assert.match(page.query("[data-event-source]").textContent, /Your text only/);
  page.input("");
  page.advance(300);
  assert.equal(page.query("[data-signal-score]").textContent, "--");
});
test("reduced motion shows the complete sample without animated timers", () => {
  const page = setup({ reduced: true });
  page.visible();
  assert.equal(page.query("[data-demo-status]").textContent, "Sample complete");
  assert.equal(page.query("[data-demo-play]").disabled, true);
  assert.ok(page.query("[data-transcript]").textContent.length > 200);
  assert.equal(page.timers.size, 0);
  page.click("[data-demo-replay]");
  assert.equal(page.timers.size, 0);
});
test("live reduced-motion preference change stops typing", () => {
  const page = setup();
  page.visible();
  page.advance(250);
  page.media("reduced", true);
  assert.equal(page.query("[data-demo-status]").textContent, "Sample complete");
  assert.equal(page.timers.size, 0);
});
test("there is no floating mascot, custom cursor, or follow setting", () => {
  const page = setup({ shared: true });
  page.pointer();
  page.advance(100);
  assert.equal(page.query(".tavi-follower"), null);
  assert.equal(page.query(".tavi-follow-setting"), null);
  assert.equal(page.storage.size, 0);
});
test(
  "candidate bundle excludes recruiter scoring and network or storage access",
  candidateIntegration,
  () => {
    const bundle = readFileSync(
      path.resolve(root, "../../Truveil-Client/interview-demo.js"),
      "utf8",
    );
    assert.doesNotMatch(
      bundle,
      /risk-model|assistantStyleDensity|AI-assistance|Risk engine|behavioralAiEventCount|local-risk|authorship probability/,
    );
    assert.doesNotMatch(
      bundle,
      /fetch\(|XMLHttpRequest|localStorage|sessionStorage/,
    );
  },
);
test(
  "candidate preview types, pauses, replays and accepts private practice text",
  candidateIntegration,
  () => {
    const page = setup({ candidate: true });
    page.visible();
    page.advance(500);
    const partial = page.query("[data-transcript]").textContent;
    assert.ok(partial.length > 0 && partial.length < 50);
    page.click("[data-demo-play]");
    page.advance(500);
    assert.equal(page.query("[data-transcript]").textContent, partial);
    page.click("[data-demo-replay]");
    page.advance(samples.grounded.text.length * 25 + 500);
    assert.equal(page.query("[data-candidate-words]").textContent, "50");
    assert.equal(page.query("[data-signal-score]"), null);
    page.click('[data-demo-mode="custom"]');
    page.input("These are my own words.");
    page.advance(300);
    assert.equal(page.query("[data-candidate-words]").textContent, "5");
    assert.equal(page.query("[data-demo-status]").textContent, "Local preview");
    page.input("");
    page.advance(300);
    assert.equal(page.query("[data-candidate-words]").textContent, "0");
  },
);
test(
  "candidate reduced-motion preview shows a complete answer immediately",
  candidateIntegration,
  () => {
    const page = setup({ candidate: true, reduced: true });
    assert.equal(page.query("[data-candidate-words]").textContent, "50");
    assert.equal(page.timers.size, 0);
  },
);
test("hero gaze maps left and right to film poses without moving the scene", () => {
  const page = setup({ motion: true });
  page.heroVisible();
  page.pointer(".cinema-set", 0);
  page.advance(1000);
  const film = page.query(".cinema-look");
  assert.ok(film.currentTime < 0.15);
  assert.equal(
    page.query(".cinema-media").classList.contains("is-looking"),
    true,
  );
  assert.equal(page.query(".cinema-set").style.transform, "");
  assert.equal(page.query("video").paused, true);
  page.pointer(".cinema-set", 1200);
  page.advance(1000);
  assert.ok(film.currentTime > 5.8);
  assert.equal(page.timers.size, 0, "No permanent animation loop");
});
test("slow video decoding never creates a queue of easing steps", () => {
  const page = setup({ motion: true, seekDelay: 70 });
  page.heroVisible();
  const film = page.query(".cinema-look");
  film.duration = 1.05;
  page.pointer(".cinema-set", 1200);
  page.advance(16);
  assert.equal(film.seekCount, 1);
  for (let x = 1100; x >= 0; x -= 100) page.pointer(".cinema-set", x);
  page.advance(86);
  assert.equal(
    film.seekCount,
    2,
    "The latest left pose is next, not intermediate stale inputs",
  );
  page.advance(86);
  assert.equal(film.presentedTime, 0);
  assert.equal(film.seekCount, 2);
  assert.equal(page.timers.size, 0);
});
test("section motion reveals once and mascot gestures run only in view", () => {
  const page = setup({ shared: true, offscreen: true });
  const heading = page.query("main h2.reveal");
  assert.ok(heading.classList.contains("pending"));
  page.intersect("main h2.reveal");
  assert.equal(heading.classList.contains("pending"), false);
  assert.ok(heading.classList.contains("revealed"));
  page.intersect(".workflow-mascot");
  assert.ok(
    page.query(".workflow-mascot").classList.contains("mascot-in-view"),
  );
  page.intersect(".workflow-mascot", false);
  assert.equal(
    page.query(".workflow-mascot").classList.contains("mascot-in-view"),
    false,
  );
  page.document.hidden = true;
  page.dispatch(page.document, "visibilitychange");
  assert.ok(page.document.body.classList.contains("ambient-still"));
});
test("ambient motion respects Save Data and live reduced-motion changes", () => {
  for (const options of [{ saveData: true }, { reduced: true }]) {
    const page = setup({ shared: true, offscreen: true, ...options });
    assert.ok(page.document.body.classList.contains("ambient-still"));
    assert.equal(page.query(".pending"), null);
  }
  const page = setup({ shared: true, offscreen: true });
  page.media("reduced", true);
  assert.equal(page.query(".pending"), null);
  assert.ok(page.document.body.classList.contains("ambient-still"));
});
test("hero gaze respects pause, offscreen, reduced motion, and coarse pointers", () => {
  const page = setup({ motion: true });
  page.heroVisible();
  page.pointer(".cinema-set", 0);
  page.advance(1000);
  const film = page.query(".cinema-look");
  page.click(".motion-toggle");
  const pausedTime = film.currentTime;
  assert.equal(
    page.query(".cinema-media").classList.contains("is-looking"),
    true,
    "Pause freezes the displayed pose",
  );
  page.pointer(".cinema-set", 1200);
  page.advance(1000);
  assert.equal(film.currentTime, pausedTime);
  assert.equal(page.query("video").paused, true);
  page.click(".motion-toggle");
  page.media("reduced", true);
  page.pointer(".cinema-set", 1200);
  page.advance(1000);
  assert.equal(film.currentTime, pausedTime);
  page.media("reduced", false);
  page.media("pointer", false);
  page.pointer(".cinema-set", 1200);
  page.advance(1000);
  assert.equal(film.currentTime, pausedTime);
  page.media("pointer", true);
  page.heroVisible(false);
  page.pointer(".cinema-set", 1200);
  page.advance(1000);
  assert.equal(film.currentTime, pausedTime);
});
test("look film is never automatically loaded for Save Data or touch users", () => {
  for (const options of [
    { saveData: true },
    { fine: false },
    { reduced: true },
  ]) {
    const page = setup({ motion: true, ...options });
    page.heroVisible();
    page.pointer(".cinema-set", 0);
    page.advance(1000);
    assert.equal(page.query(".cinema-look").getAttribute("src"), null);
  }
});
test("look-film failure falls back to the existing HQ animation", () => {
  const page = setup({ motion: true });
  page.heroVisible();
  page.pointer(".cinema-set", 0);
  page.advance(500);
  page.dispatch(page.query(".cinema-look"), "error");
  assert.equal(
    page.query(".cinema-media").classList.contains("is-looking"),
    false,
  );
  assert.equal(page.query("video").paused, false);
});
